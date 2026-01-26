import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";

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
