/**
 * Dev stack: boot a task's branch in the repository's MAIN checkout and run
 * the local stack there. Manual testing keeps one Docker stack instead of
 * one per task worktree (a full alumni_connect stack is ~20 containers and its
 * own volumes, see docs/gitworktree.md in that repo).
 *
 * One stack per supported repository (see STACKS in dev-stack-store.ts),
 * owned by a task or by a PR URL (a colleague's PR from the Reviews page,
 * which has no task). Boot detaches the main checkout at the task branch
 * (`git switch --detach`, allowed even though a worktree owns the branch) or
 * at the PR's `pull/N/head`, and runs the repository's boot command until
 * stopped. The stack counts as up once the log shows its ready line AND the
 * site answers over HTTP. Stop ends the boot process (and the Docker stack),
 * then switches the checkout back to its base branch.
 *
 * A task stack can carry more tasks: their branches are merged locally on
 * top of the owner's (merge commits never leave the detached checkout) so
 * several PRs are QA'd on one boot. Each of those tasks counts as an owner.
 */
import { mkdirSync } from "fs";
import { dirname } from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { repositories } from "../../db/schema";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { expandPath } from "../lib/path";
import { findRepository, getTaskWithRepository } from "../lib/queries";
import { loadOtherTasks } from "../lib/other-tasks";
import { parsePrUrl } from "../lib/validation";
import { changedFileCount, runGit } from "../lib/git";
import { runShell, tailOutput } from "../lib/process";
import { now } from "../lib/timestamp";
import { resolveMainPath } from "./task-worktrees";
import { listRunningContainers } from "./docker-stacks";
import {
  STACKS,
  appendLog,
  configFor,
  label,
  loadStack,
  ownerOf,
  owns,
  readLog,
  sameMerged,
  saveStack,
  type MergedTask,
  type StackConfig,
  type StoredStack,
} from "./dev-stack-store";
import { checkoutStack, shortHead } from "./dev-stack-checkout";
import { defaultRuntime, type DevStackRuntime } from "./dev-stack-runtime";
import { mintLoginLink } from "./dev-stack-login";
import { clearBlockingNodeModules } from "./dev-stack-pnpm";
import type {
  DevStack,
  DevStackLoginAs,
  DevStackLoginLink,
  DevStackOverview,
  DevStackOwner,
  DevStackRefresh,
  DevStackStatus,
} from "../../shared/types";

const STOP_TIMEOUT_MS = 3 * 60 * 1000;
const EXIT_WAIT_MS = 60_000;
const READY_TIMEOUT_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Process seam (replaced in tests, see dev-stack-runtime.ts)
// ---------------------------------------------------------------------------

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

async function toDevStack(cfg: StackConfig, repositoryId: number, stored: StoredStack): Promise<DevStack> {
  const log = await readLog(cfg);
  const { merged, ...rest } = stored;
  return {
    ...rest,
    mergedTaskIds: (merged ?? []).map((m) => m.taskId),
    repositoryId,
    alive: stored.pid !== null && runtime.isAlive(stored.pid),
    logTail: log.length > 4000 ? log.slice(-4000) : log,
    url: cfg.url,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type RepoRow = NonNullable<Awaited<ReturnType<typeof findRepository>>>;

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

/** The owner's repository with its stack config, for refresh, login links and stop. */
async function resolveStack(owner: DevStackOwner): Promise<{ repository: RepoRow; cfg: StackConfig }> {
  const { repository } = await resolveOwner(owner);
  const cfg = configFor(repository);
  if (!repository || !cfg) throw new AppError("No dev stack for this repository", 400, "DEV_STACK_UNSUPPORTED");
  return { repository, cfg };
}

/** The stored stack, refused when there is none, another owner holds it, or (with `up`) it is not up. */
async function ownedStack(cfg: StackConfig, owner: DevStackOwner, { up }: { up: boolean }): Promise<StoredStack> {
  const stored = await loadStack(cfg);
  if (!stored) throw new NotFoundError("Dev stack");
  if (!owns(stored, owner)) throw new AppError(`Dev stack belongs to ${label(stored)}`, 409, "DEV_STACK_BUSY");
  if (up && stored.state !== "up") throw new AppError("Dev stack is not up", 409, "DEV_STACK_NOT_UP");
  return stored;
}

/** Tasks to merge on top of the owner's branch: same repository, each with a branch. */
async function resolveMerged(owner: DevStackOwner, repositoryId: number, withTaskIds?: number[]): Promise<MergedTask[]> {
  const ownerId = "taskId" in owner ? owner.taskId : null;
  const others = await loadOtherTasks(withTaskIds, ownerId, repositoryId);
  if (others.length > 0 && ownerId === null) throw new ValidationError("Only a task stack can merge other tasks");
  return others.map((task) => {
    if (!task.headBranch) throw new ValidationError(`Task ${task.id} has no branch`);
    return { taskId: task.id, branch: task.headBranch };
  });
}

/** Every stack plus the repositories whose tasks may boot one (for table rows). */
export async function getDevStackOverview(): Promise<DevStackOverview> {
  const repos = await db
    .select({ id: repositories.id, repo: repositories.repo })
    .from(repositories)
    .where(and(inArray(repositories.repo, Object.keys(STACKS)), eq(repositories.enabled, 1)));
  const stacks: DevStack[] = [];
  for (const repo of repos) {
    const cfg = configFor(repo)!;
    const stored = await loadStack(cfg);
    if (stored) stacks.push(await toDevStack(cfg, repo.id, stored));
  }
  return { supportedRepositoryIds: repos.map((r) => r.id), stacks };
}

export async function getDevStackStatus(owner: DevStackOwner): Promise<DevStackStatus> {
  const { branch, repository } = await resolveOwner(owner);
  const cfg = configFor(repository);
  const stored = cfg ? await loadStack(cfg) : null;
  return {
    supported: !!cfg && !!branch,
    stack: stored ? await toDevStack(cfg!, repository!.id, stored) : null,
  };
}

/**
 * Detach the main checkout at the owner's branch, merge the branches of
 * `withTaskIds` (checked by loadOtherTasks) on top, and start the stack in the background.
 */
export async function bootDevStack(owner: DevStackOwner, withTaskIds?: number[]): Promise<DevStack> {
  const { taskId, prUrl, branch, repository } = await resolveOwner(owner);
  const cfg = configFor(repository);
  if (!repository || !cfg || !branch) {
    throw new AppError(
      `Dev stack is only available for ${Object.keys(STACKS).join(" and ")} tasks with a branch or PRs`,
      400,
      "DEV_STACK_UNSUPPORTED",
    );
  }
  const merged = await resolveMerged(owner, repository.id, withTaskIds);
  const mainPath = resolveMainPath(repository);

  const existing = await loadStack(cfg);
  if (existing && !owns(existing, owner)) {
    throw new AppError(`Dev stack is already up for ${label(existing)}`, 409, "DEV_STACK_BUSY");
  }
  if (existing && existing.state !== "failed") {
    if (existing.taskId !== taskId || !sameMerged(existing, merged)) {
      throw new AppError(`Dev stack is already up for ${label(existing)}; stop it first`, 409, "DEV_STACK_BUSY");
    }
    return toDevStack(cfg, repository.id, existing);
  }

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
    ...(merged.length > 0 && { merged }),
    state: "starting",
    pid: null,
    detail: "Checking out the branch",
    error: null,
    startedAt: now(),
  };
  await saveStack(cfg, stored);
  track(runBoot(cfg, stored, mainPath));
  return toDevStack(cfg, repository.id, stored);
}

async function runBoot(cfg: StackConfig, stored: StoredStack, mainPath: string): Promise<void> {
  const fail = (error: string) => saveStack(cfg, { ...stored, state: "failed", detail: null, error });
  try {
    const changed = await changedFileCount(mainPath);
    if (changed === null || changed > 0) {
      await fail(`Main checkout has ${changed ?? "unknown"} changed files; commit or stash them first`);
      return;
    }

    const checkoutError = await checkoutStack(mainPath, stored, false);
    if (checkoutError) {
      await fail(checkoutError);
      return;
    }

    mkdirSync(dirname(cfg.logPath), { recursive: true });
    await Bun.write(cfg.logPath, `# ${now()} boot ${label(stored)} (${await shortHead(mainPath)}) in ${mainPath}\n$ ${cfg.boot}\n`);
    const { pid, exited } = runtime.spawn(mainPath, cfg.boot, cfg.logPath);
    const booting: StoredStack = { ...stored, pid, detail: cfg.bootDetail };
    await saveStack(cfg, booting);
    watchExit(cfg, pid, exited, mainPath);
    await waitUntilReady(cfg, booting, mainPath);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * A boot process that ends on its own (while starting or up) means the stack
 * is broken. A boot that pnpm failed on a blocking node_modules directory is
 * cleared and retried once.
 */
function watchExit(cfg: StackConfig, pid: number, exited: Promise<number>, mainPath: string, retried = false): void {
  void exited.then(async (code) => {
    const current = await loadStack(cfg);
    if (current?.pid !== pid || (current.state !== "up" && current.state !== "starting")) return; // stopped by us, or superseded
    const cleared = !retried && current.state === "starting" && code !== 0 && (await clearBlockingNodeModules(mainPath, await readLog(cfg)));
    if (cleared) {
      appendLog(cfg, `# ${now()} removed ${cleared} (it blocked pnpm's symlink); booting again\n$ ${cfg.boot}`);
      const latest = await loadStack(cfg);
      if (latest?.pid !== pid || latest.state !== "starting") return; // stopped while clearing
      const next = runtime.spawn(mainPath, cfg.boot, cfg.logPath);
      const booting: StoredStack = { ...latest, pid: next.pid };
      await saveStack(cfg, booting);
      watchExit(cfg, next.pid, next.exited, mainPath, true);
      track(waitUntilReady(cfg, booting, mainPath));
      return;
    }
    await saveStack(cfg, { ...current, state: "failed", detail: null, error: `Boot process exited with code ${code}; see log` });
  });
}

/**
 * Poll until the log shows the ready line and the site answers (anything but
 * a gateway 5xx from nginx), then mark the stack up. Gives up after
 * READY_TIMEOUT_MS. Stops silently if the record changes underneath (stop,
 * failure, restart). For a Compose stack, also fails fast if its containers
 * vanish once the bundler is compiled — a crashed bundler can trigger
 * `bin/dev`'s own EXIT trap and tear the Docker stack down mid-boot, which
 * otherwise leaves this loop polling a dead gateway for the full timeout.
 */
async function waitUntilReady(cfg: StackConfig, stored: StoredStack, mainPath: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastDetail = stored.detail;
  while (Date.now() < deadline) {
    await Bun.sleep(runtime.readyPollMs);
    const current = await loadStack(cfg);
    if (!current || current.pid !== stored.pid || current.state !== "starting") return;

    const compiled = cfg.ready.test(await readLog(cfg));
    if (compiled && cfg.compose && (await runningMainContainers(mainPath)) === 0) {
      await saveStack(cfg, { ...current, state: "failed", detail: null, error: "Docker stack is not running (crashed mid-boot?); see log" });
      return;
    }

    const status = compiled ? await runtime.probe(cfg.url) : null;
    if (compiled && status !== null && status < 500) {
      await saveStack(cfg, { ...current, state: "up", detail: null });
      return;
    }

    const detail = !compiled
      ? "Waiting for the bundler to compile"
      : `Bundler ready, waiting for the web app (HTTP ${status ?? "no response"})`;
    if (detail !== lastDetail) {
      lastDetail = detail;
      await saveStack(cfg, { ...current, detail });
    }
  }
  const current = await loadStack(cfg);
  if (current?.pid === stored.pid && current.state === "starting") {
    await saveStack(cfg, { ...current, state: "failed", detail: null, error: "Stack did not become ready in time; see log" });
  }
}

/**
 * Move the running stack's detached checkout to the branch's latest commit
 * (merging the merged tasks' latest commits again), leaving the stack up so
 * the bundler (and Rails) reload in place. Local changes (db/schema.rb from
 * the boot migration) are discarded, like on stop. New migrations and
 * packages are not installed.
 */
export async function refreshDevStack(owner: DevStackOwner): Promise<DevStackRefresh> {
  const { repository, cfg } = await resolveStack(owner);
  const stored = await ownedStack(cfg, owner, { up: true });
  const mainPath = resolveMainPath(repository);

  const from = await shortHead(mainPath);
  const checkoutError = await checkoutStack(mainPath, stored, true);
  if (checkoutError) throw new AppError(checkoutError, 500, "DEV_STACK_REFRESH_FAILED");
  const to = await shortHead(mainPath);
  appendLog(cfg, `# ${now()} refresh ${label(stored)}: ${from} -> ${to}`);
  return { from, to };
}

/** A one-time sign-in link into the running alumni_connect stack as a member, network admin or super admin. */
export async function devStackLoginLink(owner: DevStackOwner, as: DevStackLoginAs, id: number | null): Promise<DevStackLoginLink> {
  const { repository, cfg } = await resolveStack(owner);
  if (repository.repo !== "alumni_connect") {
    throw new AppError("Login links are only available for the alumni_connect stack", 400, "DEV_STACK_UNSUPPORTED");
  }
  await ownedStack(cfg, owner, { up: true });
  return mintLoginLink(resolveMainPath(repository), as, id);
}

/** Stop the stack of this owner and return the main checkout to its base branch, in the background. */
export async function stopDevStack(owner: DevStackOwner): Promise<DevStack> {
  const { repository, cfg } = await resolveStack(owner);
  const stored = await ownedStack(cfg, owner, { up: false });
  if (stored.state === "stopping") return toDevStack(cfg, repository.id, stored);

  const mainPath = resolveMainPath(repository);
  const baseBranch = repository.defaultBaseBranch ?? cfg.fallbackBaseBranch;

  const stopping: StoredStack = { ...stored, state: "stopping", detail: "Stopping the stack", error: null };
  await saveStack(cfg, stopping);
  track(runStop(cfg, stopping, mainPath, baseBranch));
  return toDevStack(cfg, repository.id, stopping);
}

async function runStop(cfg: StackConfig, stored: StoredStack, mainPath: string, baseBranch: string): Promise<void> {
  const fail = (error: string) => saveStack(cfg, { ...stored, state: "failed", detail: null, error });
  try {
    if (cfg.stop) {
      appendLog(cfg, `# ${now()} stop\n$ ${cfg.stop}`);
      const stop = await runShell(mainPath, cfg.stop, { timeoutMs: STOP_TIMEOUT_MS });
      appendLog(cfg, tailOutput(stop));
    } else {
      appendLog(cfg, `# ${now()} stop`);
      if (stored.pid !== null && runtime.isAlive(stored.pid)) await runtime.killTree(stored.pid);
    }

    if (stored.pid !== null) await waitForExit(stored.pid);

    const leftover = cfg.compose ? await waitUntilDown(cfg, stored, mainPath) : 0;
    if (leftover > 0) {
      await fail(`${leftover} container(s) of the main stack are still running; see log`);
      return;
    }

    await saveStack(cfg, { ...stored, detail: `Switching back to ${baseBranch}` });
    // The boot commands (e.g. bin/dev migration) can leave tracked files
    // modified (db/schema.rb); discard that before switching or git refuses
    // to check out.
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
    appendLog(cfg, `# ${now()} back on ${baseBranch}`);
    await saveStack(cfg, null);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}

/** Running containers of the Compose project whose working dir is the main checkout; 0 when Docker is down. */
async function runningMainContainers(mainPath: string): Promise<number> {
  const dir = expandPath(mainPath);
  return (await listRunningContainers()).filter((c) => c.workingDir === dir).length;
}

/** Poll until the main stack has no running containers; returns the leftover count on timeout. */
async function waitUntilDown(cfg: StackConfig, stored: StoredStack, mainPath: string): Promise<number> {
  const deadline = Date.now() + runtime.downTimeoutMs;
  let lastDetail: string | null = null;
  let running = await runningMainContainers(mainPath);
  while (running > 0 && Date.now() < deadline) {
    const detail = `Waiting for ${running} container(s) to stop`;
    if (detail !== lastDetail) {
      lastDetail = detail;
      await saveStack(cfg, { ...stored, detail });
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
  for (const cfg of Object.values(STACKS)) {
    const stored = await loadStack(cfg);
    if (!stored) continue;

    const { repository } = await resolveOwner(ownerOf(stored)).catch(() => ({ repository: null }));
    if (!repository) {
      await saveStack(cfg, null);
      continue;
    }
    const mainPath = resolveMainPath(repository);

    if (stored.state === "starting") {
      if (stored.pid !== null && runtime.isAlive(stored.pid)) {
        track(waitUntilReady(cfg, stored, mainPath)); // boot process survived the restart; keep watching for readiness
      } else {
        await saveStack(cfg, { ...stored, state: "failed", detail: null, error: "Boot interrupted by a server restart" });
      }
    } else if (stored.state === "stopping") {
      track(runStop(cfg, stored, mainPath, repository.defaultBaseBranch ?? cfg.fallbackBaseBranch));
    }
  }
}
