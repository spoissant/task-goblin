/**
 * Re-pull one task from its sources: its Jira issue, its GitHub PR (linking the
 * PR opened from its branch when it has none yet), and its worktree's git
 * status. Also the manual links: a PR or a Jira issue attached by hand.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { getTaskOrThrow, getTaskWithRepository } from "../lib/queries";
import { fetchPrTaskData, findPrNumberByBranch } from "./github-sync";
import { upsertPrTask, writePrFields } from "./github-upsert";
import { syncJiraItemByKey } from "./jira-sync";
import { mergeSingleTask } from "./task-merge";
import { getTaskWorktreeRow, refreshTaskGitStatus } from "./task-worktrees";
import type { TaskDetail, TaskSyncResult } from "@/shared/types";

type TaskRow = typeof tasks.$inferSelect;

/**
 * Link a GitHub PR to a task. A PR-only task already holding it merges into
 * this one; a task with a Jira issue holding it is refused.
 */
export async function linkPrToTask(id: number, owner: string, repo: string, prNumber: number): Promise<TaskRow> {
  const data = await fetchPrTaskData(owner, repo, prNumber);
  const holders = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.repositoryId, data.repositoryId), eq(tasks.prNumber, data.prNumber), ne(tasks.id, id)));

  const linked = holders.find((t) => t.jiraKey);
  if (linked) {
    throw new AppError(`PR #${prNumber} is already linked to task #${linked.id}: ${linked.title}`, 409, "PR_ALREADY_LINKED");
  }
  for (const orphan of holders) await mergeSingleTask(id, orphan.id);
  await writePrFields(id, data);
  return getTaskOrThrow(id);
}

/**
 * Link the PR opened from the task's branch (its headBranch, else its worktree's
 * branch). A no-op that returns the task when it already has a PR, has no
 * branch or repository, or no PR exists for the branch yet.
 */
async function linkPrByBranch(id: number): Promise<TaskRow> {
  const task = await getTaskOrThrow(id);
  if (task.prNumber) return task;

  const worktree = await getTaskWorktreeRow(id);
  const branch = task.headBranch ?? worktree?.branch ?? null;
  const repositoryId = task.repositoryId ?? worktree?.repositoryId ?? null;
  if (!branch || !repositoryId) return task;

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, repositoryId));
  if (!repo) return task;

  const prNumber = await findPrNumberByBranch(repo.owner, repo.repo, branch);
  if (!prNumber) return task;

  return linkPrToTask(id, repo.owner, repo.repo, prNumber);
}

/** Attach a Jira issue (by key) to a PR task that has none: the issue's task merges into it. */
export async function linkJiraToTask(id: number, key: string): Promise<TaskRow> {
  const task = await getTaskOrThrow(id);
  if (!task.prNumber) throw new ValidationError("Task has no PR");
  if (task.jiraKey) throw new ValidationError("Task already has a Jira key");

  // Make sure a local task exists for the issue, then merge it into this one
  await syncJiraItemByKey(key);
  const [jiraTask] = await db.select().from(tasks).where(eq(tasks.jiraKey, key));
  if (jiraTask.prNumber) {
    throw new AppError(`${key} is already linked to task #${jiraTask.id}: ${jiraTask.title}`, 409, "JIRA_ALREADY_LINKED");
  }
  return mergeSingleTask(id, jiraTask.id);
}

/** Re-pull one task from its sources; each fails on its own. Returns the errors, per source. */
export async function syncTask(taskId: number): Promise<string[]> {
  const task = await getTaskWithRepository(taskId);
  if (!task) return [];
  const errors: string[] = [];
  const attempt = async (source: string, step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (err) {
      errors.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (task.jiraKey) await attempt("Jira", () => syncJiraItemByKey(task.jiraKey!));
  if (!task.prNumber) {
    await attempt("GitHub", () => linkPrByBranch(taskId));
  } else if (task.repository) {
    const { owner, repo } = task.repository;
    await attempt("GitHub", async () => upsertPrTask(await fetchPrTaskData(owner, repo, task.prNumber!)));
  }
  await attempt("Git status", () => refreshTaskGitStatus(taskId));
  return errors;
}

/**
 * POST /tasks/:id/sync: syncTask, then the refreshed task. A PR-only task the
 * sync merged into the Jira task its PR names comes back as that task.
 */
export async function syncTaskDetail(taskId: number): Promise<TaskSyncResult> {
  const before = await getTaskOrThrow(taskId);
  const errors = await syncTask(taskId);
  let task = await getTaskWithRepository(taskId);
  if (!task && before.repositoryId !== null && before.prNumber !== null) {
    const [holder] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.repositoryId, before.repositoryId), eq(tasks.prNumber, before.prNumber)))
      .orderBy(tasks.id)
      .limit(1);
    task = holder ? await getTaskWithRepository(holder.id) : null;
  }
  if (!task) throw new NotFoundError("Task", taskId);
  return { task, errors };
}

/**
 * Import one PR as a task, e.g. a colleague's PR the sync doesn't pull (it only
 * pulls the configured user's). Linked like a synced PR; returns the task holding it.
 */
export async function importPr(owner: string, repo: string, prNumber: number): Promise<TaskDetail> {
  const data = await fetchPrTaskData(owner, repo, prNumber);
  await upsertPrTask(data);
  const [holder] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.repositoryId, data.repositoryId), eq(tasks.prNumber, data.prNumber)))
    .orderBy(tasks.id)
    .limit(1);
  const task = holder ? await getTaskWithRepository(holder.id) : null;
  if (!task) throw new AppError(`PR #${prNumber} was not imported`, 500, "IMPORT_FAILED");
  return task;
}
