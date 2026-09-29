/**
 * Dev stack: boot a task's branch in the repository's MAIN checkout and run
 * the full local stack there. Manual testing keeps one Docker stack instead of
 * one per task worktree (a full alumni_connect stack is ~20 containers and its
 * own volumes, see docs/gitworktree.md in that repo).
 *
 * Only one stack exists at a time, owned by a task or by a PR URL (a
 * colleague's PR from the Reviews page, which has no task). Boot detaches the
 * main checkout at the task branch (`git switch --detach`, allowed even though
 * a worktree owns the branch) or at the PR's `pull/N/head`, and runs
 * BOOT_COMMAND until stopped. The stack counts as up once the
 * bundler reports a successful compile in the log AND the site answers over
 * HTTP. Stop ends the bundler and the Docker stack, then switches the checkout
 * back to its base branch.
 *
 * HARDCODED for alumni_connect: the boot/stop commands mirror the `hbup` zsh
 * alias and the repo's bin/dev tooling. A settings-driven version (per-repo
 * boot/stop commands next to setupCommand/teardownCommand) can replace these
 * constants when a second repository needs it.
 */
import { appendFileSync, closeSync, mkdirSync, openSync } from "fs";
import { dirname } from "path";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { repositories, settings } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import { expandPath } from "../lib/path";
import { findRepository, getTaskWithRepository } from "../lib/queries";
import { parsePrUrl } from "../lib/validation";
import { changedFileCount, fetchRef, localBranchExists, remoteBranchExists, runGit } from "../lib/git";
import { runCommand, runShell, tailOutput } from "../lib/process";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { resolveMainPath } from "./task-worktrees";
import type { DevStack, DevStackOverview, DevStackOwner, DevStackRefresh, DevStackState, DevStackStatus } from "../../shared/types";

const DEV_STACK_REPO = "alumni_connect";
/** Same chain as the `hbup` alias; `bin/dev start` stays in the foreground while the host bundler runs. */
const BOOT_COMMAND = "bin/dev update-dependencies && bin/dev migration && bin/dev routes-typescript && bin/dev start";
/** Killing the bundler makes `bin/dev start` return and its EXIT trap stop the stack; `dc stop` covers the rest. */
const STOP_COMMAND = "bin/dev stop-dev-server; bin/dev dc stop";
const FALLBACK_BASE_BRANCH = "sprint";
const DEV_STACK_URL = "http://localhost.hvbrt.com";
/** Printed by the Rspack dev server once the first build is served. */
const BUNDLER_READY = /Compiled successfully/;

const SETTING_KEY = "dev_stack";
const LOG_PATH = process.env.DEV_STACK_LOG ?? "logs/dev-stack.log";
const STOP_TIMEOUT_MS = 3 * 60 * 1000;
const EXIT_WAIT_MS = 60_000;
const READY_TIMEOUT_MS = 30 * 60 * 1000;

interface StoredStack {
  taskId: number | null;
  prUrl?: string | null; // set instead of taskId for a PR; absent on records from before PR boots
  branch: string; // task branch, or "repo#N" for a PR
  state: DevStackState;
  pid: number | null;
  detail: string | null;
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
  /**
   * Best-effort SIGTERM (then SIGKILL) of pid and all its descendants.
   * `bin/dev start` is a shell script whose dev-server supervisor respawns
   * children on crash and doesn't forward signals, so killing just the
   * recorded pid leaves the real work running; this walks the whole tree.
   */
  killTree(pid: number): Promise<void>;
  /** HTTP status of the booted site, or null when nothing answers. */
  probe(url: string): Promise<number | null>;
  /** Delay between readiness checks. */
  readyPollMs: number;
  /** How long to wait for the main stack's containers to stop. */
  downTimeoutMs: number;
}

const KILL_TREE_GRACE_MS = 2_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function directChildren(pid: number): Promise<number[]> {
  const proc = Bun.spawn(["pgrep", "-P", String(pid)], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** pid and every descendant, breadth-first. */
async function processTree(pid: number): Promise<number[]> {
  const all = [pid];
  let frontier = [pid];
  while (frontier.length > 0) {
    const children = (await Promise.all(frontier.map(directChildren))).flat();
    if (children.length === 0) break;
    all.push(...children);
    frontier = children;
  }
  return all;
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
  isAlive: pidAlive,
  async killTree(pid) {
    const pids = await processTree(pid);
    for (const p of pids) {
      try {
        process.kill(p, "SIGTERM");
      } catch {
        // already gone
      }
    }
    await Bun.sleep(KILL_TREE_GRACE_MS);
    for (const p of pids) {
      if (pidAlive(p)) {
        try {
          process.kill(p, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  },
  async probe(url) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      return res.status;
    } catch {
      return null;
    }
  },
  readyPollMs: 3_000,
  downTimeoutMs: 3 * 60 * 1000,
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

async function readLog(): Promise<string> {
  try {
    return await Bun.file(LOG_PATH).text();
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
  const log = await readLog();
  return {
    ...stored,
    prUrl: stored.prUrl ?? null,
    alive: stored.pid !== null && runtime.isAlive(stored.pid),
    logTail: log.length > 4000 ? log.slice(-4000) : log,
    url: DEV_STACK_URL,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The owner's repository and the branch label it boots (null when a task has no branch). */
async function resolveOwner(owner: DevStackOwner) {
  if ("prUrl" in owner) {
    const pr = parsePrUrl(owner.prUrl);
    const repository = await findRepository(pr.owner, pr.repo);
    return { taskId: null, prUrl: pr.url, branch: `${pr.repo}#${pr.number}`, repository };
  }
  const result = await getTaskWithRepository(owner.taskId);
  if (!result) throw new NotFoundError("Task", owner.taskId);
  const { repository, ...task } = result;
  return { taskId: task.id, prUrl: null, branch: task.headBranch, repository };
}

function ownerOf(stored: StoredStack): DevStackOwner {
  return stored.prUrl ? { prUrl: stored.prUrl } : { taskId: stored.taskId! };
}

function owns(stored: StoredStack, owner: DevStackOwner): boolean {
  return "prUrl" in owner ? stored.prUrl === parsePrUrl(owner.prUrl).url : stored.taskId === owner.taskId;
}

function isSupported(repository: { repo: string } | null, branch: string | null): boolean {
  return repository?.repo === DEV_STACK_REPO && !!branch;
}

/** The one stack plus the repositories whose tasks may boot it (for table rows). */
export async function getDevStackOverview(): Promise<DevStackOverview> {
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.repo, DEV_STACK_REPO), eq(repositories.enabled, 1)));
  const stored = await loadStack();
  return {
    supportedRepositoryIds: repos.map((r) => r.id),
    stack: stored ? await toDevStack(stored) : null,
  };
}

export async function getDevStackStatus(owner: DevStackOwner): Promise<DevStackStatus> {
  const { branch, repository } = await resolveOwner(owner);
  const stored = await loadStack();
  return {
    supported: isSupported(repository, branch),
    stack: stored ? await toDevStack(stored) : null,
  };
}

/** Detach the main checkout at the owner's branch and start the stack in the background. */
export async function bootDevStack(owner: DevStackOwner): Promise<DevStack> {
  const { taskId, prUrl, branch, repository } = await resolveOwner(owner);
  if (!repository || !branch || !isSupported(repository, branch)) {
    throw new AppError(`Dev stack is only available for ${DEV_STACK_REPO} tasks with a branch or PRs`, 400, "DEV_STACK_UNSUPPORTED");
  }
  const mainPath = await resolveMainPath(repository);

  const existing = await loadStack();
  if (existing && !owns(existing, owner)) {
    throw new AppError(`Dev stack is already up for ${existing.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (existing && existing.state !== "failed") return toDevStack(existing);

  // A previous attempt failed but may have left its process tree running
  // (e.g. a supervisor that respawned the dev server past the recorded
  // pid) — clean it up first so the new boot doesn't collide on the same
  // ports.
  if (existing && existing.pid !== null && runtime.isAlive(existing.pid)) {
    await runtime.killTree(existing.pid);
  }

  const stored: StoredStack = {
    taskId,
    prUrl,
    branch,
    state: "starting",
    pid: null,
    detail: "Checking out the branch",
    error: null,
    startedAt: now(),
  };
  await saveStack(stored);
  track(runBoot(stored, mainPath));
  return toDevStack(stored);
}

/**
 * A PR's head as GitHub serves it, or a task branch, fetched first and then
 * preferring the local ref (worktree commits land there) over origin.
 */
async function resolveTarget(mainPath: string, stored: StoredStack): Promise<string | null> {
  if (stored.prUrl) {
    const fetched = await fetchRef(mainPath, `pull/${parsePrUrl(stored.prUrl).number}/head`);
    return fetched.exitCode === 0 ? "FETCH_HEAD" : null;
  }
  const branch = stored.branch;
  await fetchRef(mainPath, branch);
  if (await localBranchExists(mainPath, branch)) return branch;
  if (await remoteBranchExists(mainPath, branch)) return `origin/${branch}`;
  return null;
}

async function runBoot(stored: StoredStack, mainPath: string): Promise<void> {
  const fail = (error: string) => saveStack({ ...stored, state: "failed", detail: null, error });
  try {
    const changed = await changedFileCount(mainPath);
    if (changed === null || changed > 0) {
      await fail(`Main checkout has ${changed ?? "unknown"} changed files; commit or stash them first`);
      return;
    }

    const target = await resolveTarget(mainPath, stored);
    if (!target) {
      await fail(`${stored.branch} not found locally or on origin`);
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
    const booting: StoredStack = { ...stored, pid, detail: "Running hbup" };
    await saveStack(booting);
    watchExit(pid, exited);
    await waitUntilReady(booting, mainPath);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}

/** A boot process that ends on its own (while starting or up) means the stack is broken. */
function watchExit(pid: number, exited: Promise<number>): void {
  void exited.then(async (code) => {
    const current = await loadStack();
    if (current?.pid !== pid || (current.state !== "up" && current.state !== "starting")) return; // stopped by us, or superseded
    await saveStack({ ...current, state: "failed", detail: null, error: `Boot process exited with code ${code}; see log` });
  });
}

/**
 * Poll until the bundler has compiled and the site answers (anything but a
 * gateway 5xx from nginx), then mark the stack up. Gives up after
 * READY_TIMEOUT_MS. Stops silently if the record changes underneath (stop,
 * failure, restart). Also fails fast if the main stack's containers vanish
 * once the bundler is compiled — a crashed bundler can trigger `bin/dev`'s
 * own EXIT trap and tear the Docker stack down mid-boot, which otherwise
 * leaves this loop polling a dead gateway for the full timeout.
 */
async function waitUntilReady(stored: StoredStack, mainPath: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastDetail = stored.detail;
  while (Date.now() < deadline) {
    await Bun.sleep(runtime.readyPollMs);
    const current = await loadStack();
    if (!current || current.pid !== stored.pid || current.state !== "starting") return;

    const compiled = BUNDLER_READY.test(await readLog());
    if (compiled && (await runningMainContainers(mainPath)) === 0) {
      await saveStack({ ...current, state: "failed", detail: null, error: "Docker stack is not running (crashed mid-boot?); see log" });
      return;
    }

    const status = compiled ? await runtime.probe(DEV_STACK_URL) : null;
    if (compiled && status !== null && status < 500) {
      await saveStack({ ...current, state: "up", detail: null });
      return;
    }

    const detail = !compiled
      ? "Waiting for the bundler to compile"
      : `Bundler ready, waiting for the web app (HTTP ${status ?? "no response"})`;
    if (detail !== lastDetail) {
      lastDetail = detail;
      await saveStack({ ...current, detail });
    }
  }
  const current = await loadStack();
  if (current?.pid === stored.pid && current.state === "starting") {
    await saveStack({ ...current, state: "failed", detail: null, error: "Stack did not become ready in time; see log" });
  }
}

async function shortHead(mainPath: string): Promise<string> {
  return (await runGit(mainPath, ["rev-parse", "--short", "HEAD"])).stdout.trim();
}

/**
 * Move the running stack's detached checkout to the branch's latest commit,
 * leaving the stack up so the bundler and Rails reload in place. Local changes
 * (db/schema.rb from the boot migration) are discarded, like on stop.
 * New migrations are not run.
 */
export async function refreshDevStack(owner: DevStackOwner): Promise<DevStackRefresh> {
  const stored = await loadStack();
  if (!stored) throw new NotFoundError("Dev stack");
  if (!owns(stored, owner)) {
    throw new AppError(`Dev stack belongs to ${stored.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (stored.state !== "up") throw new AppError("Dev stack is not up", 409, "DEV_STACK_NOT_UP");

  const { repository } = await resolveOwner(owner);
  if (!repository) throw new AppError("No configured repository for the dev stack", 400, "NO_REPOSITORY");
  const mainPath = await resolveMainPath(repository);

  const target = await resolveTarget(mainPath, stored);
  if (!target) throw new AppError(`${stored.branch} not found locally or on origin`, 404, "BRANCH_NOT_FOUND");

  const from = await shortHead(mainPath);
  const switched = await runGit(mainPath, ["switch", "--detach", "--discard-changes", target]);
  if (switched.exitCode !== 0) {
    throw new AppError(switched.stderr || `git switch --detach ${target} failed`, 500, "DEV_STACK_REFRESH_FAILED");
  }
  const to = await shortHead(mainPath);
  appendLog(`# ${now()} refresh ${stored.branch} (${target}): ${from} -> ${to}`);
  return { from, to };
}

/** Stop the stack of this owner and return the main checkout to its base branch, in the background. */
export async function stopDevStack(owner: DevStackOwner): Promise<DevStack> {
  const stored = await loadStack();
  if (!stored) throw new NotFoundError("Dev stack");
  if (!owns(stored, owner)) {
    throw new AppError(`Dev stack belongs to ${stored.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (stored.state === "stopping") return toDevStack(stored);

  const { repository } = await resolveOwner(owner);
  if (!repository) throw new AppError("No configured repository for the dev stack", 400, "NO_REPOSITORY");
  const mainPath = await resolveMainPath(repository);
  const baseBranch = repository.defaultBaseBranch ?? FALLBACK_BASE_BRANCH;

  const stopping: StoredStack = { ...stored, state: "stopping", detail: "Stopping the bundler and containers", error: null };
  await saveStack(stopping);
  track(runStop(stopping, mainPath, baseBranch));
  return toDevStack(stopping);
}

async function runStop(stored: StoredStack, mainPath: string, baseBranch: string): Promise<void> {
  const fail = (error: string) => saveStack({ ...stored, state: "failed", detail: null, error });
  try {
    appendLog(`# ${now()} stop\n$ ${STOP_COMMAND}`);
    const stop = await runShell(mainPath, STOP_COMMAND, { timeoutMs: STOP_TIMEOUT_MS });
    appendLog(tailOutput(stop));

    if (stored.pid !== null) await waitForExit(stored.pid);

    const leftover = await waitUntilDown(stored, mainPath);
    if (leftover > 0) {
      await fail(`${leftover} container(s) of the main stack are still running; see log`);
      return;
    }

    await saveStack({ ...stored, detail: `Switching back to ${baseBranch}` });
    // The boot commands (e.g. bin/dev migration) always leave db/schema.rb
    // modified; discard that before switching or git refuses to check out.
    const reset = await runGit(mainPath, ["reset", "--hard"]);
    if (reset.exitCode !== 0) {
      await fail(`Stack stopped but git reset --hard failed: ${reset.stderr}`);
      return;
    }
    const switched = await runGit(mainPath, ["switch", baseBranch]);
    if (switched.exitCode !== 0) {
      await fail(`Stack stopped but git switch ${baseBranch} failed: ${switched.stderr}`);
      return;
    }
    appendLog(`# ${now()} back on ${baseBranch}`);
    await saveStack(null);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}

/** Running containers of the Compose project whose working dir is the main checkout. */
async function runningMainContainers(mainPath: string): Promise<number> {
  const result = await runCommand(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project.working_dir=${expandPath(mainPath)}`],
    { cwd: process.cwd(), timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) return 0; // Docker down: nothing can be running
  return result.stdout.split("\n").filter(Boolean).length;
}

/** Poll until the main stack has no running containers; returns the leftover count on timeout. */
async function waitUntilDown(stored: StoredStack, mainPath: string): Promise<number> {
  const deadline = Date.now() + runtime.downTimeoutMs;
  let lastDetail: string | null = null;
  let running = await runningMainContainers(mainPath);
  while (running > 0 && Date.now() < deadline) {
    const detail = `Waiting for ${running} container(s) to stop`;
    if (detail !== lastDetail) {
      lastDetail = detail;
      await saveStack({ ...stored, detail });
    }
    await Bun.sleep(runtime.readyPollMs);
    running = await runningMainContainers(mainPath);
  }
  return running;
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (runtime.isAlive(pid) && Date.now() < deadline) {
    await Bun.sleep(500);
  }
  if (runtime.isAlive(pid)) await runtime.killTree(pid);
}

/** Resume work interrupted by a server restart. */
export async function reconcileDevStack(): Promise<void> {
  const stored = await loadStack();
  if (!stored) return;

  const { repository } = await resolveOwner(ownerOf(stored)).catch(() => ({ repository: null }));
  if (!repository) {
    await saveStack(null);
    return;
  }
  const mainPath = await resolveMainPath(repository);

  if (stored.state === "starting") {
    if (stored.pid !== null && runtime.isAlive(stored.pid)) {
      track(waitUntilReady(stored, mainPath)); // boot process survived the restart; keep watching for readiness
    } else {
      await saveStack({ ...stored, state: "failed", detail: null, error: "Boot interrupted by a server restart" });
    }
  } else if (stored.state === "stopping") {
    track(runStop(stored, mainPath, repository.defaultBaseBranch ?? FALLBACK_BASE_BRANCH));
  }
}
