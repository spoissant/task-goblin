import { existsSync } from "fs";
import { basename, dirname } from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { taskWorktrees, claudeSessions, tasks, type repositories } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import { expandPath } from "../lib/path";
import { now } from "../lib/timestamp";
import { getTaskWithRepository, getWorktreePath } from "../lib/queries";
import { getCompletedCondition } from "../lib/task-status";
import { runShell, tailOutput } from "../lib/process";
import { changedFileCount, fetchRef, localBranchExists, remoteBranchExists, runGit, unpushedCommitCount, worktreePrune } from "../lib/git";
import { wtPreStart, wtRemove, wtSwitch } from "../lib/wt";
import { broadcast } from "../lib/sse";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;
export type TaskWorktreeRow = typeof taskWorktrees.$inferSelect;

const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
const TEARDOWN_TIMEOUT_MS = 5 * 60 * 1000;
export const ACTIVE_SESSION_STATES = ["queued", "preparing", "working", "blocked"] as const;

/**
 * Where wt puts the worktree of `branch`: a sibling of the main checkout,
 * `<main>.<branch>` with `/` sanitized, keeping the `~` form. Only a
 * placeholder until wt reports the real path.
 */
export function worktreePathFor(mainPath: string, branch: string): string {
  const trimmed = mainPath.replace(/\/+$/, "");
  return `${dirname(trimmed)}/${basename(trimmed)}.${branch.replaceAll("/", "-")}`;
}

/** Docker Compose project name the repo tooling derives from a worktree directory. */
export async function composeProjectFor(worktreePath: string): Promise<string> {
  const expanded = expandPath(worktreePath);
  try {
    const env = await Bun.file(`${expanded}/.env.worktree`).text();
    const match = env.match(/^COMPOSE_PROJECT_NAME=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // no .env.worktree yet: fall back to the same sanitization as script/worktree/core.sh
  }
  return basename(expanded).toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Branch the worktree checks out: the task's PR branch when it has one, else
 * `<fix|feat|chore>/<KEY>` by Jira issue type (same rule as the start-task skill).
 */
export function branchNameFor(task: Pick<TaskRow, "id" | "jiraKey" | "type" | "headBranch">): string {
  if (task.headBranch) return task.headBranch;
  const type = task.type?.toLowerCase();
  const prefix = type === "bug" || type === "incident" ? "fix" : type === "story" ? "feat" : "chore";
  return `${prefix}/${task.jiraKey ?? `task-${task.id}`}`;
}

/** Resolve the repository's main checkout path or throw the usual guard errors. */
export async function resolveMainPath(repository: RepoRow): Promise<string> {
  const mainPath = await getWorktreePath(repository.id);
  if (!mainPath) {
    throw new AppError("Repository local path not configured", 400, "REPO_PATH_NOT_CONFIGURED");
  }
  if (!existsSync(expandPath(mainPath))) {
    throw new AppError(`Repository path does not exist: ${mainPath}`, 400, "REPO_PATH_NOT_FOUND");
  }
  return mainPath;
}

async function loadTaskAndRepo(taskId: number): Promise<{ task: TaskRow; repository: RepoRow }> {
  const result = await getTaskWithRepository(taskId);
  if (!result) throw new NotFoundError("Task", taskId);
  const { repository, ...task } = result;
  if (!repository) throw new AppError("Task has no associated repository", 400, "NO_REPOSITORY");
  return { task, repository };
}

export async function getTaskWorktreeRow(taskId: number): Promise<TaskWorktreeRow | null> {
  const rows = await db.select().from(taskWorktrees).where(eq(taskWorktrees.taskId, taskId));
  return rows[0] ?? null;
}

async function updateRow(id: number, updates: Partial<TaskWorktreeRow>): Promise<TaskWorktreeRow> {
  const rows = await db
    .update(taskWorktrees)
    .set({ ...updates, updatedAt: now() })
    .where(eq(taskWorktrees.id, id))
    .returning();
  const row = rows[0];
  broadcast("worktree", { taskId: row.taskId, state: row.state });
  return row;
}

async function hasActiveSession(taskId: number): Promise<boolean> {
  const rows = await db
    .select({ id: claudeSessions.id })
    .from(claudeSessions)
    .where(and(eq(claudeSessions.taskId, taskId), inArray(claudeSessions.state, [...ACTIVE_SESSION_STATES])))
    .limit(1);
  return rows.length > 0;
}

// In-flight preparations, so concurrent callers share one run per task.
const inFlight = new Map<number, Promise<TaskWorktreeRow>>();

/**
 * Make sure the task has a ready worktree. Idempotent: reuses a registered
 * worktree, re-runs setup after a failure, and dedupes concurrent calls.
 * Resolves to the row in its final state (ready or failed); never throws
 * once the guards have passed.
 */
export function ensureTaskWorktree(taskId: number): Promise<TaskWorktreeRow> {
  const existing = inFlight.get(taskId);
  if (existing) return existing;
  const run = prepare(taskId).finally(() => inFlight.delete(taskId));
  inFlight.set(taskId, run);
  return run;
}

/**
 * Run the synchronous guards and create/refresh the row in `preparing`, then
 * continue the preparation in the background. Used by the POST endpoint so
 * the caller gets a 202 quickly with the row.
 */
export async function startTaskWorktreePreparation(taskId: number): Promise<TaskWorktreeRow> {
  const { task, repository } = await loadTaskAndRepo(taskId);
  const mainPath = await resolveMainPath(repository);
  const row = await upsertPreparing(task, repository, mainPath);
  void ensureTaskWorktree(taskId);
  return row;
}

async function upsertPreparing(task: TaskRow, repository: RepoRow, mainPath: string): Promise<TaskWorktreeRow> {
  const existing = await getTaskWorktreeRow(task.id);
  if (existing) {
    if (existing.repositoryId !== repository.id) {
      // Task moved to another repository: point the row at the new checkout.
      const branch = branchNameFor(task);
      return updateRow(existing.id, {
        repositoryId: repository.id,
        path: worktreePathFor(mainPath, branch),
        branch,
        state: "preparing",
        error: null,
        setupLog: null,
        readyAt: null,
      });
    }
    if (existing.state === "ready") return existing;
    return updateRow(existing.id, { state: "preparing", error: null });
  }
  const timestamp = now();
  const branch = branchNameFor(task);
  const rows = await db
    .insert(taskWorktrees)
    .values({
      taskId: task.id,
      repositoryId: repository.id,
      path: worktreePathFor(mainPath, branch),
      branch,
      state: "preparing",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  broadcast("worktree", { taskId: task.id, state: "preparing" });
  return rows[0];
}

async function prepare(taskId: number): Promise<TaskWorktreeRow> {
  const { task, repository } = await loadTaskAndRepo(taskId);
  const mainPath = await resolveMainPath(repository);
  let row = await upsertPreparing(task, repository, mainPath);

  if (row.state === "ready" && existsSync(expandPath(row.path))) {
    return row;
  }
  if (row.state === "ready") {
    // Row says ready but the directory is gone: rebuild it.
    row = await updateRow(row.id, { state: "preparing", error: null });
  }

  // wt checks out an existing branch (local or origin) or reuses the worktree
  // that already has it; a new branch starts from the repository's base.
  const branch = task.headBranch ?? row.branch ?? branchNameFor(task);
  await fetchRef(mainPath, branch);
  const exists = (await localBranchExists(mainPath, branch)) || (await remoteBranchExists(mainPath, branch));
  let base: string | undefined;
  if (!exists) {
    const baseBranch = repository.defaultBaseBranch ?? task.baseBranch ?? "main";
    await fetchRef(mainPath, baseBranch);
    base = `origin/${baseBranch}`;
  }
  const switched = await wtSwitch(mainPath, branch, base);
  if (!switched.path) {
    return updateRow(row.id, { state: "failed", error: tailOutput(switched.result, 500) || "wt switch failed" });
  }
  if (switched.path === expandPath(mainPath)) {
    return updateRow(row.id, {
      state: "failed",
      error: `Branch ${branch} is checked out in the main checkout; switch it to another branch first`,
    });
  }
  row = await updateRow(row.id, { path: switched.path, branch });

  // Setup: the repository's wt pre-start hooks, then its extra setup command.
  const hooks = await wtPreStart(row.path, SETUP_TIMEOUT_MS);
  let log = tailOutput(hooks);
  if (hooks.exitCode !== 0) {
    return updateRow(row.id, { state: "failed", setupLog: log, error: `wt pre-start hooks failed (exit ${hooks.exitCode})` });
  }
  if (repository.setupCommand) {
    const setup = await runShell(row.path, repository.setupCommand, { timeoutMs: SETUP_TIMEOUT_MS });
    log = [log, tailOutput(setup)].filter(Boolean).join("\n");
    if (setup.exitCode !== 0) {
      return updateRow(row.id, { state: "failed", setupLog: log, error: `Setup command failed (exit ${setup.exitCode})` });
    }
  }

  return updateRow(row.id, { state: "ready", setupLog: log || null, error: null, readyAt: now() });
}

export async function getTaskWorktreeStatus(taskId: number) {
  const row = await getTaskWorktreeRow(taskId);
  if (!row) return null;
  const expanded = expandPath(row.path);
  const changedFiles =
    (row.state === "ready" || row.state === "dirty") && existsSync(expanded)
      ? await changedFileCount(row.path)
      : null;
  return { ...row, changedFiles };
}

/**
 * Remove the task's worktree. Refuses while a session is active, and refuses
 * a dirty worktree unless forced. Returns the row in `removing`; the teardown
 * finishes in the background and deletes the row.
 */
export async function removeTaskWorktree(taskId: number, opts: { force: boolean }): Promise<TaskWorktreeRow> {
  const row = await getTaskWorktreeRow(taskId);
  if (!row) throw new NotFoundError("Worktree for task", taskId);
  if (await hasActiveSession(taskId)) {
    throw new AppError("A session is still active on this task", 409, "SESSION_ACTIVE");
  }
  const expanded = expandPath(row.path);
  if (!opts.force && existsSync(expanded)) {
    const changed = await changedFileCount(row.path);
    if (changed === null || changed > 0) {
      throw new AppError(`Worktree has ${changed ?? "unknown"} changed files`, 409, "WORKTREE_DIRTY");
    }
  }
  const removing = await updateRow(row.id, { state: "removing", error: null });
  void finishRemoval(removing, opts.force);
  return removing;
}

async function finishRemoval(row: TaskWorktreeRow, force: boolean): Promise<void> {
  try {
    const result = await getTaskWithRepository(row.taskId);
    const repository = result?.repository ?? null;
    const mainPath = repository ? await getWorktreePath(repository.id) : null;
    const expanded = expandPath(row.path);

    // Teardown only needs the compose project name, so run it from the main
    // checkout when the worktree directory is already gone (deleted by hand).
    const cwd = existsSync(expanded) ? row.path : mainPath;
    if (repository?.teardownCommand && cwd) {
      const project = await composeProjectFor(row.path);
      const command = repository.teardownCommand.replaceAll("{{composeProject}}", project);
      const teardown = await runShell(cwd, command, { timeoutMs: TEARDOWN_TIMEOUT_MS });
      if (teardown.exitCode !== 0) {
        console.warn(`[worktree] teardown failed for task ${row.taskId}: ${tailOutput(teardown, 500)}`);
      }
    }

    if (mainPath) {
      if (existsSync(expanded)) {
        // wt runs the repository's pre-remove hooks (e.g. Docker teardown) first.
        const removed = await wtRemove(mainPath, expanded, force, TEARDOWN_TIMEOUT_MS);
        if (removed.exitCode !== 0) {
          await updateRow(row.id, { state: "failed", error: tailOutput(removed, 500) || "wt remove failed" });
          return;
        }
      }
      await worktreePrune(mainPath);
    }

    await db.delete(taskWorktrees).where(eq(taskWorktrees.id, row.id));
    await db.update(tasks).set({ uncommittedFiles: null, unpushedCommits: null }).where(eq(tasks.id, row.taskId));
    broadcast("worktree", { taskId: row.taskId, state: null });
  } catch (err) {
    await updateRow(row.id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Tear down a task's worktree before the task row is deleted, since the
 * cascade would otherwise drop the row and leak its Docker stack. A dirty
 * worktree keeps its directory (git refuses) but still loses its stack.
 */
export async function teardownBeforeTaskDelete(taskId: number): Promise<void> {
  const row = await getTaskWorktreeRow(taskId);
  if (row) await finishRemoval(row, false);
}

/**
 * Remove worktrees of completed tasks (PR merged/closed or completed status)
 * when they are clean; flag dirty ones instead of deleting work.
 */
export async function reapCompletedWorktrees(): Promise<void> {
  const completed = await getCompletedCondition();
  const rows = await db
    .select({ worktree: taskWorktrees })
    .from(taskWorktrees)
    .innerJoin(tasks, eq(tasks.id, taskWorktrees.taskId))
    .where(and(eq(taskWorktrees.state, "ready"), completed));
  for (const { worktree } of rows) {
    if (await hasActiveSession(worktree.taskId)) continue;
    try {
      await removeTaskWorktree(worktree.taskId, { force: false });
    } catch (err) {
      if (err instanceof AppError && err.code === "WORKTREE_DIRTY") {
        await updateRow(worktree.id, { state: "dirty", error: err.message });
      } else {
        console.warn(`[worktree] reap failed for task ${worktree.taskId}:`, err);
      }
    }
  }
}

/** Store the worktree's uncommitted file and unpushed commit counts on its task. */
async function refreshGitStatus(row: TaskWorktreeRow): Promise<void> {
  const present = (row.state === "ready" || row.state === "dirty") && existsSync(expandPath(row.path));
  const uncommittedFiles = present ? await changedFileCount(row.path) : null;
  const unpushedCommits = present ? await unpushedCommitCount(row.path) : null;
  await db.update(tasks).set({ uncommittedFiles, unpushedCommits }).where(eq(tasks.id, row.taskId));
}

/** Refresh git status for every task worktree; run after the GitHub sync. */
export async function refreshWorktreeGitStatuses(): Promise<void> {
  const rows = await db.select().from(taskWorktrees);
  for (const row of rows) await refreshGitStatus(row);
}

/** Push the worktree's branch to origin (setting upstream), then refresh its status. */
export async function pushTaskWorktree(taskId: number): Promise<void> {
  const row = await getTaskWorktreeRow(taskId);
  if (!row) throw new NotFoundError("Worktree for task", taskId);
  if (!row.branch) throw new AppError("Worktree has no branch to push", 400, "WORKTREE_DETACHED");
  const result = await runGit(row.path, ["push", "-u", "origin", row.branch]);
  await refreshGitStatus(row);
  if (result.exitCode !== 0) {
    throw new AppError(`git push failed: ${tailOutput(result, 500)}`, 502, "PUSH_FAILED");
  }
}

/** Resume work interrupted by a server restart. */
export async function reconcileWorktrees(): Promise<void> {
  const rows = await db
    .select()
    .from(taskWorktrees)
    .where(inArray(taskWorktrees.state, ["preparing", "removing"]));
  for (const row of rows) {
    if (row.state === "preparing") void ensureTaskWorktree(row.taskId);
    else void finishRemoval(row, true);
  }
}
