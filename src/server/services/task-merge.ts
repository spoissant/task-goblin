import { eq, and, isNotNull, isNull, or, ne } from "drizzle-orm";
import { db } from "../../db";
import { tasks, taskWorktrees, claudeSessions } from "../../db/schema";
import { moveSessionLinks } from "./session-tasks";
import { json } from "../response";
import { AppError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { getNotCompletedCondition } from "../lib/task-status";
import { getTaskOrThrow } from "../lib/queries";
import { getTaskWorktreeRow, teardownBeforeTaskDelete } from "./task-worktrees";
import { syncJiraItemByKey, JiraApiError } from "./jira-sync";
import { JiraConfigError } from "../lib/jira-client";
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
        await getNotCompletedCondition()
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
      // A Jira task already set to another repository is not this PR's: a
      // hivetests PR's branch carries its alumni_connect parent's key too.
      if (jiraTask.repositoryId && prTask.repositoryId && jiraTask.repositoryId !== prTask.repositoryId) continue;

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
  const [target, source] = await Promise.all([
    getTaskOrThrow(targetId),
    getTaskOrThrow(sourceId),
  ]);

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
    mergedFields.isDraft = prTask.isDraft;
    mergedFields.checksStatus = prTask.checksStatus;
    mergedFields.checksDetails = prTask.checksDetails;
    mergedFields.reviewStatus = prTask.reviewStatus;
    mergedFields.unresolvedCommentCount = prTask.unresolvedCommentCount;
    mergedFields.prSyncedAt = prTask.prSyncedAt;
  }
  // If target is PR task, copy Jira fields from source
  else if (target.prNumber && !target.jiraKey) {
    mergedFields.jiraKey = jiraTask.jiraKey;
    mergedFields.status = jiraTask.status;
    mergedFields.type = jiraTask.type;
    mergedFields.assignee = jiraTask.assignee;
    mergedFields.priority = jiraTask.priority;
    mergedFields.sprint = jiraTask.sprint;
    mergedFields.epicKey = jiraTask.epicKey;
    mergedFields.parentKey = jiraTask.parentKey;
    // Use Jira summary as title if target doesn't have a good title
    if (jiraTask.title && jiraTask.title !== prTask.headBranch) {
      mergedFields.title = jiraTask.title;
    }
  }

  // The source's worktree moves to the target below; if the target already has
  // one, tear the source's down now so deleting the source doesn't leak it.
  if (await getTaskWorktreeRow(targetId)) await teardownBeforeTaskDelete(sourceId);

  // Wrap all merge operations in a transaction for consistency
  const result = await db.transaction(async (tx) => {
    await tx
      .update(taskWorktrees)
      .set({ taskId: targetId })
      .where(eq(taskWorktrees.taskId, sourceId));

    await tx
      .update(claudeSessions)
      .set({ taskId: targetId })
      .where(eq(claudeSessions.taskId, sourceId));
    await moveSessionLinks(tx, sourceId, targetId);

    // Delete source before updating target: jira_key is unique, so the target
    // can't take the source's key while the source still holds it.
    await tx.delete(tasks).where(eq(tasks.id, sourceId));

    const updated = await tx
      .update(tasks)
      .set(mergedFields)
      .where(eq(tasks.id, targetId))
      .returning();

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
  // Manually attach a Jira issue (by key) to a PR task that has none
  "/api/v1/tasks/:id/assign-jira": {
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      const key = typeof body.key === "string" ? body.key.trim().toUpperCase() : "";

      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
        throw new ValidationError("Invalid Jira key. Expected format: PROJ-123");
      }

      const task = await getTaskOrThrow(id);
      if (!task.prNumber) throw new ValidationError("Task has no PR");
      if (task.jiraKey) throw new ValidationError("Task already has a Jira key");

      // Make sure a local task exists for the issue, then merge it into this one
      try {
        await syncJiraItemByKey(key);
      } catch (err) {
        if (err instanceof JiraConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof JiraApiError) {
          const statusCode =
            err.code === "JIRA_AUTH_FAILED" ? 401 :
            err.code === "JIRA_ISSUE_NOT_FOUND" ? 404 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }

      const [jiraTask] = await db.select().from(tasks).where(eq(tasks.jiraKey, key));
      if (jiraTask.prNumber) {
        throw new AppError(
          `${key} is already linked to task #${jiraTask.id}: ${jiraTask.title}`,
          409,
          "JIRA_ALREADY_LINKED"
        );
      }

      return json(await mergeSingleTask(id, jiraTask.id));
    },
  },
};
