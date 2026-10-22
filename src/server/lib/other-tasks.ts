import { NotFoundError, ValidationError } from "./errors";
import { getTaskWithRepository } from "./queries";

type TaskWithRepository = NonNullable<Awaited<ReturnType<typeof getTaskWithRepository>>>;

/**
 * The other tasks a run takes on besides its own: a bulk chore's, or the ones
 * a dev stack merges on top of its owner's branch. `ids` is the request's
 * `withTaskIds` as sent: nothing, or an array of positive integer task IDs.
 * Repeats and the run's own task drop out; each task must exist and, given a
 * repository, be in it.
 */
export async function loadOtherTasks(
  ids: unknown,
  ownTaskId: number | null,
  repositoryId?: number,
): Promise<TaskWithRepository[]> {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    throw new ValidationError("withTaskIds must be an array of task IDs");
  }
  const others: TaskWithRepository[] = [];
  for (const id of new Set<number>(ids)) {
    if (id === ownTaskId) continue;
    const task = await getTaskWithRepository(id);
    if (!task) throw new NotFoundError("Task", id);
    if (repositoryId !== undefined && task.repository?.id !== repositoryId) {
      throw new ValidationError(`Task ${id} is in another repository`);
    }
    others.push(task);
  }
  return others;
}
