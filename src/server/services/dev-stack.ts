/**
 * Dev stack: boot a task's branch in the repository's MAIN checkout and run
 * the full local stack there. Manual testing keeps one Docker stack instead of
 * one per task worktree (a full alumni_connect stack is ~20 containers and its
 * own volumes, see docs/gitworktree.md in that repo).
 *
 * Only one stack exists at a time. Boot detaches the main checkout at the task
 * branch (`git switch --detach`, allowed even though a worktree owns the
 * branch) and runs BOOT_COMMAND until stopped. Stop ends the bundler and the
 * Docker stack, then switches the checkout back to its base branch.
 *
 * HARDCODED for alumni_connect: the boot/stop commands mirror the `hbup` zsh
 * alias and the repo's bin/dev tooling. A settings-driven version (per-repo
 * boot/stop commands next to setupCommand/teardownCommand) can replace these
 * constants when a second repository needs it.
 */
import { appendFileSync, closeSync, mkdirSync, openSync } from "fs";
import { dirname } from "path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import { expandPath } from "../lib/path";
import { getTaskWithRepository } from "../lib/queries";
import { changedFileCount, fetchRef, localBranchExists, remoteBranchExists, runGit } from "../lib/git";
import { runShell, tailOutput } from "../lib/process";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { resolveMainPath } from "./task-worktrees";
import type { DevStack, DevStackState, DevStackStatus } from "../../shared/types";

const DEV_STACK_REPO = "alumni_connect";
/** Same chain as the `hbup` alias; `bin/dev start` stays in the foreground while the host bundler runs. */
const BOOT_COMMAND = "bin/dev update-dependencies && bin/dev migration && bin/dev routes-typescript && bin/dev start";
/** Killing the bundler makes `bin/dev start` return and its EXIT trap stop the stack; `dc stop` covers the rest. */
const STOP_COMMAND = "bin/dev stop-dev-server; bin/dev dc stop";
const FALLBACK_BASE_BRANCH = "sprint";
const DEV_STACK_URL = "http://localhost.hvbrt.com";

const SETTING_KEY = "dev_stack";
const LOG_PATH = "logs/dev-stack.log";
const STOP_TIMEOUT_MS = 3 * 60 * 1000;
const EXIT_WAIT_MS = 60_000;

interface StoredStack {
  taskId: number;
  branch: string;
  state: DevStackState;
  pid: number | null;
  error: string | null;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Process seam (replaced in tests)
// ---------------------------------------------------------------------------

export interface DevStackRuntime {
  /** Start the long-running boot command with stdout/stderr appended to `logPath`. */
  spawn(cwd: string, logPath: string): { pid: number; exited: Promise<number> };
  isAlive(pid: number): boolean;
}

const defaultRuntime: DevStackRuntime = {
  spawn(cwd, logPath) {
    const fd = openSync(logPath, "a");
    const proc = Bun.spawn(["/bin/zsh", "-lc", BOOT_COMMAND], {
      cwd: expandPath(cwd),
      stdout: fd,
      stderr: fd,
      stdin: "ignore",
    });
    const exited = proc.exited.finally(() => closeSync(fd));
    return { pid: proc.pid, exited };
  },
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

let runtime = defaultRuntime;
export function setDevStackRuntime(rt: DevStackRuntime | null): void {
  runtime = rt ?? defaultRuntime;
}

// Background work in flight; tests await it.
let inFlight: Promise<void> = Promise.resolve();
export function devStackSettled(): Promise<void> {
  return inFlight;
}
function track(work: Promise<void>): void {
  inFlight = inFlight.then(() => work, () => work);
}

// ---------------------------------------------------------------------------
// Persistence (settings row, survives server restarts)
// ---------------------------------------------------------------------------

async function loadStack(): Promise<StoredStack | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTING_KEY));
  if (!rows[0]?.value) return null;
  try {
    return JSON.parse(rows[0].value) as StoredStack;
  } catch {
    return null;
  }
}

async function saveStack(stack: StoredStack | null): Promise<void> {
  if (stack) {
    const value = JSON.stringify(stack);
    await db.insert(settings).values({ key: SETTING_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  } else {
    await db.delete(settings).where(eq(settings.key, SETTING_KEY));
  }
  broadcast("dev-stack", { taskId: stack?.taskId ?? null, state: stack?.state ?? null });
}

async function readLogTail(max = 4000): Promise<string> {
  try {
    const text = await Bun.file(LOG_PATH).text();
    return text.length > max ? text.slice(-max) : text;
  } catch {
    return "";
  }
}

function appendLog(text: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    // logging only
  }
}

async function toDevStack(stored: StoredStack): Promise<DevStack> {
  return {
    ...stored,
    alive: stored.pid !== null && runtime.isAlive(stored.pid),
    logTail: await readLogTail(),
    url: DEV_STACK_URL,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function loadTaskAndRepo(taskId: number) {
  const result = await getTaskWithRepository(taskId);
  if (!result) throw new NotFoundError("Task", taskId);
  const { repository, ...task } = result;
  return { task, repository };
}

function isSupported(repository: { repo: string } | null, headBranch: string | null): boolean {
  return repository?.repo === DEV_STACK_REPO && !!headBranch;
}

export async function getDevStackStatus(taskId: number): Promise<DevStackStatus> {
  const { task, repository } = await loadTaskAndRepo(taskId);
  const stored = await loadStack();
  return {
    supported: isSupported(repository, task.headBranch),
    stack: stored ? await toDevStack(stored) : null,
  };
}

/** Detach the main checkout at the task branch and start the stack in the background. */
export async function bootDevStack(taskId: number): Promise<DevStack> {
  const { task, repository } = await loadTaskAndRepo(taskId);
  if (!repository || !task.headBranch || !isSupported(repository, task.headBranch)) {
    throw new AppError(`Dev stack is only available for ${DEV_STACK_REPO} tasks with a branch`, 400, "DEV_STACK_UNSUPPORTED");
  }
  const mainPath = await resolveMainPath(repository);

  const existing = await loadStack();
  if (existing && existing.taskId !== taskId) {
    throw new AppError(`Dev stack is already up for ${existing.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (existing && existing.state !== "failed") return toDevStack(existing);

  const stored: StoredStack = {
    taskId,
    branch: task.headBranch,
    state: "starting",
    pid: null,
    error: null,
    startedAt: now(),
  };
  await saveStack(stored);
  track(runBoot(stored, mainPath));
  return toDevStack(stored);
}

async function runBoot(stored: StoredStack, mainPath: string): Promise<void> {
  const fail = (error: string) => saveStack({ ...stored, state: "failed", error });
  try {
    const changed = await changedFileCount(mainPath);
    if (changed === null || changed > 0) {
      await fail(`Main checkout has ${changed ?? "unknown"} changed files; commit or stash them first`);
      return;
    }

    await fetchRef(mainPath, stored.branch);
    let target: string;
    if (await localBranchExists(mainPath, stored.branch)) target = stored.branch;
    else if (await remoteBranchExists(mainPath, stored.branch)) target = `origin/${stored.branch}`;
    else {
      await fail(`Branch ${stored.branch} not found locally or on origin`);
      return;
    }

    const switched = await runGit(mainPath, ["switch", "--detach", target]);
    if (switched.exitCode !== 0) {
      await fail(switched.stderr || `git switch --detach ${target} failed`);
      return;
    }

    mkdirSync(dirname(LOG_PATH), { recursive: true });
    await Bun.write(LOG_PATH, `# ${now()} boot ${stored.branch} (${target}) in ${mainPath}\n$ ${BOOT_COMMAND}\n`);
    const { pid, exited } = runtime.spawn(mainPath, LOG_PATH);
    const up: StoredStack = { ...stored, state: "up", pid };
    await saveStack(up);

    void exited.then(async (code) => {
      const current = await loadStack();
      if (current?.pid !== pid || current.state !== "up") return; // stopped by us, or superseded
      await saveStack({ ...current, state: "failed", error: `Boot process exited with code ${code}; see log` });
    });
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}

/** Stop the stack of this task and return the main checkout to its base branch, in the background. */
export async function stopDevStack(taskId: number): Promise<DevStack> {
  const stored = await loadStack();
  if (!stored) throw new NotFoundError("Dev stack");
  if (stored.taskId !== taskId) {
    throw new AppError(`Dev stack belongs to ${stored.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (stored.state === "stopping") return toDevStack(stored);

  const { repository } = await loadTaskAndRepo(taskId);
  if (!repository) throw new AppError("Task has no associated repository", 400, "NO_REPOSITORY");
  const mainPath = await resolveMainPath(repository);
  const baseBranch = repository.defaultBaseBranch ?? FALLBACK_BASE_BRANCH;

  const stopping: StoredStack = { ...stored, state: "stopping", error: null };
  await saveStack(stopping);
  track(runStop(stopping, mainPath, baseBranch));
  return toDevStack(stopping);
}

async function runStop(stored: StoredStack, mainPath: string, baseBranch: string): Promise<void> {
  try {
    appendLog(`# ${now()} stop\n$ ${STOP_COMMAND}`);
    const stop = await runShell(mainPath, STOP_COMMAND, { timeoutMs: STOP_TIMEOUT_MS });
    appendLog(tailOutput(stop));

    if (stored.pid !== null) await waitForExit(stored.pid);

    const switched = await runGit(mainPath, ["switch", baseBranch]);
    if (switched.exitCode !== 0) {
      await saveStack({ ...stored, state: "failed", error: `Stack stopped but git switch ${baseBranch} failed: ${switched.stderr}` });
      return;
    }
    appendLog(`# ${now()} back on ${baseBranch}`);
    await saveStack(null);
  } catch (err) {
    await saveStack({ ...stored, state: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (runtime.isAlive(pid) && Date.now() < deadline) {
    await Bun.sleep(500);
  }
  if (runtime.isAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

/** Resume work interrupted by a server restart. */
export async function reconcileDevStack(): Promise<void> {
  const stored = await loadStack();
  if (!stored) return;
  if (stored.state === "starting") {
    await saveStack({ ...stored, state: "failed", error: "Boot interrupted by a server restart" });
  } else if (stored.state === "stopping") {
    const { repository } = await loadTaskAndRepo(stored.taskId).catch(() => ({ repository: null }));
    if (!repository) {
      await saveStack(null);
      return;
    }
    const mainPath = await resolveMainPath(repository);
    track(runStop(stored, mainPath, repository.defaultBaseBranch ?? FALLBACK_BASE_BRANCH));
  }
}
