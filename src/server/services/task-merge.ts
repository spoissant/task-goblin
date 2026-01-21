import { eq, and, isNotNull, isNull, or, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, blockedBy } from "../../db/schema";
import { json } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { JIRA_COMPLETED_STATUSES, jiraStatusNotInCondition, statusOrderExpr } from "../lib/task-status";
import type { Routes } from "../router";

export const taskMergeRoutes: Routes = {
  // Merge two orphan tasks (jira + pr) into one
  "/api/v1/tasks/:id/merge": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.sourceTaskId || typeof body.sourceTaskId !== "number") {
        throw new ValidationError("sourceTaskId is required");
      }

      const targetTask = await db.select().from(tasks).where(eq(tasks.id, id));
      if (targetTask.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const sourceTask = await db.select().from(tasks).where(eq(tasks.id, body.sourceTaskId));
      if (sourceTask.length === 0) {
        throw new NotFoundError("Task", body.sourceTaskId);
      }

      const target = targetTask[0];
      const source = sourceTask[0];

      // Determine which has Jira and which has PR
      const jiraTask = target.jiraKey ? target : source.jiraKey ? source : null;
      const prTask = target.prNumber ? target : source.prNumber ? source : null;

      if (!jiraTask || !prTask) {
        throw new ValidationError("One task must have jiraKey and the other must have prNumber");
      }

      if (jiraTask.id === prTask.id) {
        throw new ValidationError("Cannot merge a task with itself");
      }

      // Merge: copy fields from source to target
      const mergedFields: Record<string, unknown> = { updatedAt: now() };

      // If target is Jira task, copy PR fields from source
      if (target.jiraKey && !target.prNumber) {
        mergedFields.prNumber = prTask.prNumber;
        mergedFields.repositoryId = prTask.repositoryId;
        mergedFields.headBranch = prTask.headBranch;
        mergedFields.baseBranch = prTask.baseBranch;
        mergedFields.prState = prTask.prState;
        mergedFields.prAuthor = prTask.prAuthor;
        mergedFields.isDraft = prTask.isDraft;
        mergedFields.checksStatus = prTask.checksStatus;
        mergedFields.checksDetails = prTask.checksDetails;
        mergedFields.approvedReviewCount = prTask.approvedReviewCount;
        mergedFields.unresolvedCommentCount = prTask.unresolvedCommentCount;
        mergedFields.reviewStatus = prTask.reviewStatus;
        mergedFields.prSyncedAt = prTask.prSyncedAt;
      }
      // If target is PR task, copy Jira fields from source
      else if (target.prNumber && !target.jiraKey) {
        mergedFields.jiraKey = jiraTask.jiraKey;
        mergedFields.type = jiraTask.type;
        mergedFields.assignee = jiraTask.assignee;
        mergedFields.priority = jiraTask.priority;
        mergedFields.sprint = jiraTask.sprint;
        mergedFields.epicKey = jiraTask.epicKey;
        mergedFields.lastComment = jiraTask.lastComment;
        mergedFields.jiraSyncedAt = jiraTask.jiraSyncedAt;
        // Use Jira summary as title if target doesn't have a good title
        if (jiraTask.title && jiraTask.title !== prTask.headBranch) {
          mergedFields.title = jiraTask.title;
        }
        if (jiraTask.description) {
          mergedFields.description = jiraTask.description;
        }
      }

      // Update target with merged fields
      const result = await db
        .update(tasks)
        .set(mergedFields)
        .where(eq(tasks.id, id))
        .returning();

      // Move todos from source to target
      await db
        .update(todos)
        .set({ taskId: id })
        .where(eq(todos.taskId, body.sourceTaskId));

      // Move blockedBy relations from source to target
      await db
        .update(blockedBy)
        .set({ blockedTaskId: id })
        .where(eq(blockedBy.blockedTaskId, body.sourceTaskId));

      // Delete source task
      await db.delete(tasks).where(eq(tasks.id, body.sourceTaskId));

      return json(result[0]);
    },
  },

  // Split a merged task back into two orphans
  "/api/v1/tasks/:id/split": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const task = existing[0];

      // Must be a merged task (both jiraKey and prNumber)
      if (!task.jiraKey || !task.prNumber) {
        throw new ValidationError("Task must have both jiraKey and prNumber to split");
      }

      const timestamp = now();

      // Create new PR orphan task with PR fields
      const newPrTask = await db
        .insert(tasks)
        .values({
          title: task.headBranch || `PR #${task.prNumber}`,
          description: null,
          status: task.status,
          prNumber: task.prNumber,
          repositoryId: task.repositoryId,
          headBranch: task.headBranch,
          baseBranch: task.baseBranch,
          prState: task.prState,
          prAuthor: task.prAuthor,
          isDraft: task.isDraft,
          checksStatus: task.checksStatus,
          reviewStatus: task.reviewStatus,
          unresolvedCommentCount: task.unresolvedCommentCount,
          prSyncedAt: task.prSyncedAt,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      // Clear PR fields from original task (keep as Jira orphan)
      const result = await db
        .update(tasks)
        .set({
          prNumber: null,
          repositoryId: null,
          headBranch: null,
          baseBranch: null,
          prState: null,
          prAuthor: null,
          isDraft: null,
          checksStatus: null,
          reviewStatus: null,
          unresolvedCommentCount: null,
          prSyncedAt: null,
          updatedAt: timestamp,
        })
        .where(eq(tasks.id, id))
        .returning();

      return json({
        jiraTask: result[0],
        prTask: newPrTask[0],
      });
    },
  },

  // Auto-match orphans by finding jiraKey in branch names/titles
  "/api/v1/tasks/auto-match": {
    async POST() {
      // Get all non-completed Jira orphans
      const jiraOrphans = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.jiraKey),
            isNull(tasks.prNumber),
            jiraStatusNotInCondition()
          )
        );

      // Get all non-merged PR orphans
      const prOrphans = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.prNumber),
            isNull(tasks.jiraKey),
            or(isNull(tasks.prState), ne(tasks.prState, "merged"))
          )
        );

      const matches: Array<{ jiraTaskId: number; prTaskId: number; jiraKey: string }> = [];

      // For each PR orphan, try to find matching Jira key in branch name or title
      for (const prTask of prOrphans) {
        const searchText = `${prTask.headBranch || ""} ${prTask.title || ""}`.toUpperCase();

        for (const jiraTask of jiraOrphans) {
          if (!jiraTask.jiraKey) continue;

          // Check if jira key appears in the PR's branch or title
          if (searchText.includes(jiraTask.jiraKey.toUpperCase())) {
            matches.push({
              jiraTaskId: jiraTask.id,
              prTaskId: prTask.id,
              jiraKey: jiraTask.jiraKey,
            });
            break; // Only one match per PR
          }
        }
      }

      return json({ matches, total: matches.length });
    },
  },
};
