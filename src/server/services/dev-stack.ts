/**
 * Dev stack: boot a task's branch in the repository's MAIN checkout and run
 * the local stack there. Manual testing keeps one Docker stack instead of
 * one per task worktree (a full alumni_connect stack is ~20 containers and its
 * own volumes, see docs/gitworktree.md in that repo).
 *
 * One stack per supported repository (see STACKS), owned by a task or by a PR
 * URL (a colleague's PR from the Reviews page, which has no task). Boot
 * detaches the main checkout at the task branch (`git switch --detach`,
 * allowed even though a worktree owns the branch) or at the PR's
 * `pull/N/head`, and runs the repository's boot command until stopped. The
 * stack counts as up once the log shows its ready line AND the site answers
 * over HTTP. Stop ends the boot process (and the Docker stack), then switches
 * the checkout back to its base branch.
 *
 * HARDCODED per repository: alumni_connect mirrors the `hbup` zsh alias and
 * the repo's bin/dev tooling; front-monorepo runs Storybook.
 */
import { appendFileSync, closeSync, mkdirSync, openSync } from "fs";
import { dirname } from "path";
import { and, eq, inArray } from "drizzle-orm";
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
import type {
  DevStack,
  DevStackLoginAs,
  DevStackLoginLink,
  DevStackOverview,
  DevStackOwner,
  DevStackRefresh,
  DevStackState,
  DevStackStatus,
} from "../../shared/types";

interface StackConfig {
  /** Stays in the foreground while the stack runs. */
  boot: string;
  /** Run on stop before waiting for the boot process; null kills the process tree right away. */
  stop: string | null;
  url: string;
  /** Log line printed once the first build is served. */
  ready: RegExp;
  bootDetail: string;
  /** Runs a Docker Compose project from the main checkout; its containers are watched. */
  compose: boolean;
  fallbackBaseBranch: string;
  settingKey: string;
  logPath: string;
}

const LOG_PATH = process.env.DEV_STACK_LOG ?? "logs/dev-stack.log";

const STACKS: Record<string, StackConfig> = {
  alumni_connect: {
    // Same chain as the `hbup` alias; `bin/dev start` stays in the foreground while the host bundler runs.
    boot: "bin/dev update-dependencies && bin/dev migration && bin/dev routes-typescript && bin/dev start",
    // Killing the bundler makes `bin/dev start` return and its EXIT trap stop the stack; `dc stop` covers the rest.
    stop: "bin/dev stop-dev-server; bin/dev dc stop",
    url: "http://localhost.hvbrt.com",
    ready: /Compiled successfully/, // Rspack dev server
    bootDetail: "Running hbup",
    compose: true,
    fallbackBaseBranch: "sprint",
    settingKey: "dev_stack",
    logPath: LOG_PATH,
  },
  "front-monorepo": {
    // No TTY, so pnpm can't ask before purging an incompatible node_modules.
    boot: "pnpm install --frozen-lockfile --config.confirmModulesPurge=false && pnpm nx run storybook:dev",
    stop: null,
    url: "http://localhost:4400",
    ready: /Storybook ready!/,
    bootDetail: "Installing packages and starting Storybook",
    compose: false,
    fallbackBaseBranch: "main",
    settingKey: "dev_stack:front-monorepo",
    logPath: LOG_PATH.replace(/(\.log)?$/, "-storybook.log"),
  },
};

function configFor(repository: { repo: string } | null): StackConfig | null {
  return repository && Object.hasOwn(STACKS, repository.repo) ? STACKS[repository.repo] : null;
}
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
  spawn(cwd: string, command: string, logPath: string): { pid: number; exited: Promise<number> };
  isAlive(pid: number): boolean;
  /**
   * Best-effort SIGTERM (then SIGKILL) of pid and all its descendants.
   * `bin/dev start` is a shell script whose dev-server supervisor respawns
   * children on crash and doesn't forward signals (and nx runs Storybook as
   * a child), so killing just the recorded pid leaves the real work running;
   * this walks the whole tree.
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
  spawn(cwd, command, logPath) {
    const fd = openSync(logPath, "a");
    const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
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

async function loadStack(cfg: StackConfig): Promise<StoredStack | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, cfg.settingKey));
  if (!rows[0]?.value) return null;
  try {
    return JSON.parse(rows[0].value) as StoredStack;
  } catch {
    return null;
  }
}

async function saveStack(cfg: StackConfig, stack: StoredStack | null): Promise<void> {
  if (stack) {
    const value = JSON.stringify(stack);
    await db.insert(settings).values({ key: cfg.settingKey, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  } else {
    await db.delete(settings).where(eq(settings.key, cfg.settingKey));
  }
  broadcast("dev-stack", { taskId: stack?.taskId ?? null, state: stack?.state ?? null });
}

async function readLog(cfg: StackConfig): Promise<string> {
  try {
    return await Bun.file(cfg.logPath).text();
  } catch {
    return "";
  }
}

function appendLog(cfg: StackConfig, text: string): void {
  try {
    mkdirSync(dirname(cfg.logPath), { recursive: true });
    appendFileSync(cfg.logPath, text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    // logging only
  }
}

async function toDevStack(cfg: StackConfig, repositoryId: number, stored: StoredStack): Promise<DevStack> {
  const log = await readLog(cfg);
  return {
    ...stored,
    prUrl: stored.prUrl ?? null,
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

/** The owner's repository with its stack config, for stop and refresh. */
async function resolveStack(owner: DevStackOwner): Promise<{ repository: RepoRow; cfg: StackConfig }> {
  const { repository } = await resolveOwner(owner);
  const cfg = configFor(repository);
  if (!repository || !cfg) throw new AppError("No dev stack for this repository", 400, "DEV_STACK_UNSUPPORTED");
  return { repository, cfg };
}

function ownerOf(stored: StoredStack): DevStackOwner {
  return stored.prUrl ? { prUrl: stored.prUrl } : { taskId: stored.taskId! };
}

function owns(stored: StoredStack, owner: DevStackOwner): boolean {
  return "prUrl" in owner ? stored.prUrl === parsePrUrl(owner.prUrl).url : stored.taskId === owner.taskId;
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

/** Detach the main checkout at the owner's branch and start the stack in the background. */
export async function bootDevStack(owner: DevStackOwner): Promise<DevStack> {
  const { taskId, prUrl, branch, repository } = await resolveOwner(owner);
  const cfg = configFor(repository);
  if (!repository || !cfg || !branch) {
    throw new AppError(
      `Dev stack is only available for ${Object.keys(STACKS).join(" and ")} tasks with a branch or PRs`,
      400,
      "DEV_STACK_UNSUPPORTED",
    );
  }
  const mainPath = await resolveMainPath(repository);

  const existing = await loadStack(cfg);
  if (existing && !owns(existing, owner)) {
    throw new AppError(`Dev stack is already up for ${existing.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (existing && existing.state !== "failed") return toDevStack(cfg, repository.id, existing);

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
  await saveStack(cfg, stored);
  track(runBoot(cfg, stored, mainPath));
  return toDevStack(cfg, repository.id, stored);
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

async function runBoot(cfg: StackConfig, stored: StoredStack, mainPath: string): Promise<void> {
  const fail = (error: string) => saveStack(cfg, { ...stored, state: "failed", detail: null, error });
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

    mkdirSync(dirname(cfg.logPath), { recursive: true });
    await Bun.write(cfg.logPath, `# ${now()} boot ${stored.branch} (${target}) in ${mainPath}\n$ ${cfg.boot}\n`);
    const { pid, exited } = runtime.spawn(mainPath, cfg.boot, cfg.logPath);
    const booting: StoredStack = { ...stored, pid, detail: cfg.bootDetail };
    await saveStack(cfg, booting);
    watchExit(cfg, pid, exited);
    await waitUntilReady(cfg, booting, mainPath);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}

/** A boot process that ends on its own (while starting or up) means the stack is broken. */
function watchExit(cfg: StackConfig, pid: number, exited: Promise<number>): void {
  void exited.then(async (code) => {
    const current = await loadStack(cfg);
    if (current?.pid !== pid || (current.state !== "up" && current.state !== "starting")) return; // stopped by us, or superseded
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

async function shortHead(mainPath: string): Promise<string> {
  return (await runGit(mainPath, ["rev-parse", "--short", "HEAD"])).stdout.trim();
}

/**
 * Move the running stack's detached checkout to the branch's latest commit,
 * leaving the stack up so the bundler (and Rails) reload in place. Local
 * changes (db/schema.rb from the boot migration) are discarded, like on stop.
 * New migrations and packages are not installed.
 */
export async function refreshDevStack(owner: DevStackOwner): Promise<DevStackRefresh> {
  const { repository, cfg } = await resolveStack(owner);
  const stored = await loadStack(cfg);
  if (!stored) throw new NotFoundError("Dev stack");
  if (!owns(stored, owner)) {
    throw new AppError(`Dev stack belongs to ${stored.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (stored.state !== "up") throw new AppError("Dev stack is not up", 409, "DEV_STACK_NOT_UP");

  const mainPath = await resolveMainPath(repository);

  const target = await resolveTarget(mainPath, stored);
  if (!target) throw new AppError(`${stored.branch} not found locally or on origin`, 404, "BRANCH_NOT_FOUND");

  const from = await shortHead(mainPath);
  const switched = await runGit(mainPath, ["switch", "--detach", "--discard-changes", target]);
  if (switched.exitCode !== 0) {
    throw new AppError(switched.stderr || `git switch --detach ${target} failed`, 500, "DEV_STACK_REFRESH_FAILED");
  }
  const to = await shortHead(mainPath);
  appendLog(cfg, `# ${now()} refresh ${stored.branch} (${target}): ${from} -> ${to}`);
  return { from, to };
}

/**
 * Mints the same signed, single-use "log as" claim link the super-admin panel
 * hands out (LogAs::Grant, 10 minutes), from the CLI with the first super
 * admin as impersonator, so a browser signs in without a password or an
 * existing session. Defaults to the first confirmed member / admin of network
 * 1 (pandora). Prints one JSON line.
 */
const LOGIN_LINK_SCRIPT = `
as, id = ARGV
id = id.presence&.to_i
sa = SuperAdmin.order(:id).first or abort("No super admin in the local DB")
case as
when "member"
  subject = id ? User.kept.confirmed.find_by(id:) : Network.find(1).users.kept.confirmed.order(:id).first
  kind, impersonator = :user, sa
when "admin"
  subject = id ? SimpleAdmin.find_by(id:) : SimpleAdmin.where(network_id: 1).order(:id).first
  kind, impersonator = :simple_admin, sa
when "super_admin"
  subject = sa
  kind, impersonator = :super_admin_network, nil
else
  abort("Unknown role #{as}")
end
abort("No #{as} found#{" with id #{id}" if id}") unless subject
network = as == "super_admin" ? Network.find(1) : subject.network
routing = SharedRouting.routing_for(network)
destination_url = as == "member" ? routing.user_url(subject) : routing.backoffice_root_url
token = LogAs::Grant.generate(subject:, network:, kind:, destination_url:, impersonator:)
puts({url: routing.backoffice_log_as_claim_url(token:), subjectId: subject.id, name: subject.try(:name).presence || subject.email, networkId: network.id}.to_json)
`;
const LOGIN_LINK_TIMEOUT_MS = 3 * 60 * 1000;

/** A one-time sign-in link into the running alumni_connect stack as a member, network admin or super admin. */
export async function devStackLoginLink(owner: DevStackOwner, as: DevStackLoginAs, id: number | null): Promise<DevStackLoginLink> {
  const { repository, cfg } = await resolveStack(owner);
  if (repository.repo !== "alumni_connect") {
    throw new AppError("Login links are only available for the alumni_connect stack", 400, "DEV_STACK_UNSUPPORTED");
  }
  const stored = await loadStack(cfg);
  if (!stored) throw new NotFoundError("Dev stack");
  if (!owns(stored, owner)) {
    throw new AppError(`Dev stack belongs to ${stored.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (stored.state !== "up") throw new AppError("Dev stack is not up", 409, "DEV_STACK_NOT_UP");

  const mainPath = await resolveMainPath(repository);
  // Script and arguments go through as positional parameters ($0, $@), so nothing needs shell quoting.
  const result = await runCommand(
    "/bin/zsh",
    ["-lc", 'bin/dev dcx webapp bundle exec rails runner "$0" "$@"', LOGIN_LINK_SCRIPT, as, id === null ? "" : String(id)],
    { cwd: mainPath, timeoutMs: LOGIN_LINK_TIMEOUT_MS },
  );
  const line = result.exitCode === 0 ? result.stdout.split("\n").reverse().find((l) => l.startsWith("{")) : undefined;
  if (!line) {
    throw new AppError(`Could not mint a login link: ${tailOutput(result, 1000)}`, 500, "DEV_STACK_LOGIN_FAILED");
  }
  return JSON.parse(line) as DevStackLoginLink;
}

/** Stop the stack of this owner and return the main checkout to its base branch, in the background. */
export async function stopDevStack(owner: DevStackOwner): Promise<DevStack> {
  const { repository, cfg } = await resolveStack(owner);
  const stored = await loadStack(cfg);
  if (!stored) throw new NotFoundError("Dev stack");
  if (!owns(stored, owner)) {
    throw new AppError(`Dev stack belongs to ${stored.branch}`, 409, "DEV_STACK_BUSY");
  }
  if (stored.state === "stopping") return toDevStack(cfg, repository.id, stored);

  const mainPath = await resolveMainPath(repository);
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
    const mainPath = await resolveMainPath(repository);

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
