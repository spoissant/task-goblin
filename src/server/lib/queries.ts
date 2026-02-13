import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories, worktrees } from "../../db/schema";

export type TaskWithRepository = {
  task: typeof tasks.$inferSelect;
  repository: typeof repositories.$inferSelect | null;
};

/**
 * Fetch a task with its associated repository (if any).
 * Returns null if task not found.
 */
export async function getTaskWithRepository(
  taskId: number
): Promise<TaskWithRepository | null> {
  const result = await db
    .select({
      task: tasks,
      repository: repositories,
    })
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(eq(tasks.id, taskId));

  if (result.length === 0) {
    return null;
  }

  return result[0];
}

/**
 * Get the first worktree path for a repository.
 * Returns null if no worktrees configured.
 */
export async function getWorktreePath(
  repositoryId: number
): Promise<string | null> {
  const result = await db
    .select({ path: worktrees.path })
    .from(worktrees)
    .where(eq(worktrees.repositoryId, repositoryId))
    .limit(1);

  return result[0]?.path ?? null;
}
