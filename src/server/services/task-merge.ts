import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks, taskWorktrees, claudeSessions } from "../../db/schema";
import { moveSessionLinks } from "./session-tasks";
import { ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getTaskOrThrow } from "../lib/queries";
import { getTaskWorktreeRow, teardownBeforeTaskDelete } from "./task-worktrees";
import { prFieldsOf } from "./github-mappers";
import { JIRA_FIELDS } from "./jira-sync";

type TaskRow = typeof tasks.$inferSelect;

/** The Jira side of a task: its key and the fields the Jira sync writes. */
function jiraFieldsOf(task: TaskRow): Partial<TaskRow> {
  return { jiraKey: task.jiraKey, ...Object.fromEntries(JIRA_FIELDS.map((field) => [field, task[field]])) };
}

/**
 * Merge `source` into `target`, which keeps its id and takes what it lacks of
 * the source's PR and Jira issue, its sessions, and its worktree unless it has
 * one. The source is deleted.
 */
export async function mergeSingleTask(targetId: number, sourceId: number): Promise<TaskRow> {
  if (targetId === sourceId) throw new ValidationError("Cannot merge a task with itself");
  const [target, source] = await Promise.all([getTaskOrThrow(targetId), getTaskOrThrow(sourceId)]);

  const mergedFields: Partial<TaskRow> = {
    ...(!target.prNumber && source.prNumber ? prFieldsOf(source) : {}),
    ...(!target.jiraKey && source.jiraKey ? jiraFieldsOf(source) : {}),
    updatedAt: now(),
  };

  // The source's worktree moves to the target below; if the target already has
  // one, tear the source's down now so deleting the source doesn't leak it.
  if (await getTaskWorktreeRow(targetId)) await teardownBeforeTaskDelete(sourceId);

  // Wrap all merge operations in a transaction for consistency
  return db.transaction(async (tx) => {
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
}
