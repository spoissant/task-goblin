import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks, worktrees } from "../../db/schema";

/**
 * Fetch a task with its associated repository (if any).
 * Returns null if task not found.
 */
export async function getTaskWithRepository(taskId: number) {
  return (
    (await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      with: { repository: true },
    })) ?? null
  );
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
