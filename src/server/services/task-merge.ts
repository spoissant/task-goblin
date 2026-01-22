import { eq, and, isNotNull, isNull, or, ne } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, blockedBy } from "../../db/schema";
import { json } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { jiraStatusNotInCondition } from "../lib/task-status";
import type { Routes } from "../router";

export interface AutoMatchPair {
  jiraTaskId: number;
  prTaskId: number;
  jiraKey: string;
}

/**
 * Find potential auto-match pairs between Jira orphans and PR orphans.
 * Matches by finding Jira key in PR's branch name or title.
 */
export async function findAutoMatches(): Promise<AutoMatchPair[]> {
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
        or(
          isNull(tasks.prState),
          and(ne(tasks.prState, "merged"), ne(tasks.prState, "closed"))
        )
      )
    );

  const matches: AutoMatchPair[] = [];

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

  return matches;
}

/**
 * Merge a single task pair (Jira target + PR source).
 * Returns the merged task.
 */
export async function mergeSingleTask(
  targetId: number,
  sourceId: number
): Promise<typeof tasks.$inferSelect> {
  const targetTask = await db.select().from(tasks).where(eq(tasks.id, targetId));
  if (targetTask.length === 0) {
    throw new NotFoundError("Task", targetId);
  }

  const sourceTask = await db.select().from(tasks).where(eq(tasks.id, sourceId));
  if (sourceTask.length === 0) {
    throw new NotFoundError("Task", sourceId);
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
    mergedFields.jiraSyncedAt = jiraTask.jiraSyncedAt;
    // Use Jira summary as title if target doesn't have a good title
    if (jiraTask.title && jiraTask.title !== prTask.headBranch) {
      mergedFields.title = jiraTask.title;
    }
    if (jiraTask.description) {
      mergedFields.description = jiraTask.description;
    }
  }

  // Wrap all merge operations in a transaction for consistency
  const result = await db.transaction(async (tx) => {
    // Update target with merged fields
    const updated = await tx
      .update(tasks)
      .set(mergedFields)
      .where(eq(tasks.id, targetId))
      .returning();

    // Move todos from source to target
    await tx
      .update(todos)
      .set({ taskId: targetId })
      .where(eq(todos.taskId, sourceId));

    // Move blockedBy relations from source to target
    await tx
      .update(blockedBy)
      .set({ blockedTaskId: targetId })
      .where(eq(blockedBy.blockedTaskId, sourceId));

    // Delete source task
    await tx.delete(tasks).where(eq(tasks.id, sourceId));

    return updated[0];
  });

  return result;
}

/**
 * Find auto-matches and merge them all. Returns the number of merged pairs.
 */
export async function autoMatchAndMerge(): Promise<number> {
  const matches = await findAutoMatches();

  for (const match of matches) {
    await mergeSingleTask(match.jiraTaskId, match.prTaskId);
  }

  return matches.length;
}

export const taskMergeRoutes: Routes = {
  // Merge two orphan tasks (jira + pr) into one
  "/api/v1/tasks/:id/merge": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.sourceTaskId || typeof body.sourceTaskId !== "number") {
        throw new ValidationError("sourceTaskId is required");
      }

      const result = await mergeSingleTask(id, body.sourceTaskId);
      return json(result);
    },
  },

  // Split a merged task back into two orphans
  "/api/v1/tasks/:id/split": {
    async POST(_req, params) {
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

      // Wrap split operations in a transaction for consistency
      const { jiraTask, prTask } = await db.transaction(async (tx) => {
        // Create new PR orphan task with PR fields
        const newPrTask = await tx
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
            unresolvedCommentCount: task.unresolvedCommentCount,
            prSyncedAt: task.prSyncedAt,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();

        // Clear PR fields from original task (keep as Jira orphan)
        const updatedJiraTask = await tx
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
            unresolvedCommentCount: null,
            prSyncedAt: null,
            updatedAt: timestamp,
          })
          .where(eq(tasks.id, id))
          .returning();

        return { jiraTask: updatedJiraTask[0], prTask: newPrTask[0] };
      });

      return json({ jiraTask, prTask });
    },
  },
};
