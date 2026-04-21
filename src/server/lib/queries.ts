import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, worktrees, repositories } from "../../db/schema";
import { NotFoundError } from "./errors";

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
 * Build a Map of repository ID → repository for a list of tasks.
 */
export async function buildRepoMap(
  taskList: { repositoryId: number | null }[],
): Promise<Map<number, typeof repositories.$inferSelect>> {
  const repoIds = [...new Set(taskList.filter(t => t.repositoryId).map(t => t.repositoryId!))];
  const repoMap = new Map<number, typeof repositories.$inferSelect>();

  if (repoIds.length > 0) {
    const repos = await db
      .select()
      .from(repositories)
      .where(sql`${repositories.id} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`);
    for (const repo of repos) {
      repoMap.set(repo.id, repo);
    }
  }

  return repoMap;
}

export async function getTaskOrThrow(id: number): Promise<typeof tasks.$inferSelect> {
  const result = await db.select().from(tasks).where(eq(tasks.id, id));
  if (result.length === 0) throw new NotFoundError("Task", id);
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
