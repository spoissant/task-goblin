/**
 * Background Claude Code sessions per task: one fresh session per chore run,
 * never resumed. Continuity lives in the worktree, Task Goblin and the PR.
 * PR reviews from the Reviews page are the exception: no task, keyed by PR URL.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, repositories, tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { findRepository, getTaskWithRepository } from "../lib/queries";
import { parsePrUrl } from "../lib/validation";
import { CUSTOM_CHORE, REVIEW_CHORE, fingerprintFor, getChoreDefinition, isBulkChore, resolvePrompt } from "../lib/chores";
import { broadcast } from "../lib/sse";
import type { ClaudeSession, ClaudeSessionState } from "../../shared/types";
import {
  listAgents,
  pendingQuestion,
  readJobState,
  respawnSession as cliRespawn,
  sessionLink,
  spawnBackground,
  stopSession as cliStop,
  type JobState,
} from "./claude-cli";
import {
  branchForTask,
  ensureTaskWorktree,
  getTaskWorktreeRow,
  reconcileWorktrees,
  resolveMainPath,
  worktreePathFor,
} from "./task-worktrees";
import { getDevStackStatus } from "./dev-stack";
import { coversTasks, coveredTaskIds, linkSessionTasks, sessionLinks, type SessionTaskLink } from "./session-tasks";

export type SessionRow = typeof claudeSessions.$inferSelect;

export const ACTIVE_STATES: ClaudeSessionState[] = ["queued", "preparing", "working", "blocked"];
export const TERMINAL_STATES: ClaudeSessionState[] = ["done", "failed", "stopped"];
const POLLED_STATES: ClaudeSessionState[] = ["working", "blocked"];
const MISSING_STATE_TOLERANCE = 6; // poll ticks before a missing state.json is treated as a vanished session
const REAP_IDLE_MS = 10 * 60 * 1000;

export type CapacityCheck = (cwd: string) => Promise<"ok" | "queued">;
let capacityCheck: CapacityCheck = async () => "ok";

/** Slice 4 installs the Docker stack cap here. */
export function setCapacityCheck(fn: CapacityCheck): void {
  capacityCheck = fn;
}

export type SessionFinishedHook = (taskId: number) => void;
let onSessionFinished: SessionFinishedHook = () => {};

/** Called when a task's session reaches a terminal state; the runtime syncs the task here. */
export function setOnSessionFinished(fn: SessionFinishedHook): void {
  onSessionFinished = fn;
}

/** API shape of each row, with the other tasks a bulk run covers. */
export async function toApiList<T extends SessionRow>(rows: T[]): Promise<(T & ClaudeSession)[]> {
  const links = await sessionLinks(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...row,
    state: row.state as ClaudeSessionState,
    link: sessionLink(row.bridgeSessionId),
    linkedTaskIds: (links.get(row.id) ?? []).map((l) => l.taskId),
  }));
}

export async function toApi(row: SessionRow): Promise<ClaudeSession> {
  return (await toApiList([row]))[0];
}

async function getRow(id: number): Promise<SessionRow | null> {
  const rows = await db.select().from(claudeSessions).where(eq(claudeSessions.id, id));
  return rows[0] ?? null;
}

async function updateRow(id: number, updates: Partial<SessionRow>): Promise<SessionRow> {
  const rows = await db
    .update(claudeSessions)
    .set({ ...updates, updatedAt: now() })
    .where(eq(claudeSessions.id, id))
    .returning();
  const row = rows[0];
  broadcast("session", { taskId: row.taskId, id: row.id, state: row.state });
  if (TERMINAL_STATES.includes(row.state as ClaudeSessionState)) broadcast("task", { taskId: row.taskId });
  return row;
}

export async function getSession(id: number): Promise<SessionRow> {
  const row = await getRow(id);
  if (!row) throw new NotFoundError("Session", id);
  return row;
}

/** The task's sessions, bulk runs it is linked into included. */
export async function listTaskSessions(taskId: number): Promise<SessionRow[]> {
  return db.select().from(claudeSessions).where(coversTasks([taskId])).orderBy(desc(claudeSessions.id));
}

/** Newest session per task, linked tasks of bulk runs included, for the tasks table. */
export async function listLatestSessions(): Promise<SessionRow[]> {
  return db
    .select()
    .from(claudeSessions)
    .where(
      sql`${claudeSessions.id} IN (SELECT MAX(id) FROM (
        SELECT id, task_id FROM claude_sessions WHERE task_id IS NOT NULL
        UNION ALL SELECT session_id, task_id FROM claude_session_tasks
      ) GROUP BY task_id)`,
    )
    .orderBy(desc(claudeSessions.id));
}

/** Newest session per reviewed PR, for the Reviews page. */
export async function listLatestReviewSessions(): Promise<SessionRow[]> {
  return db
    .select()
    .from(claudeSessions)
    .where(
      sql`${claudeSessions.id} IN (SELECT MAX(id) FROM claude_sessions WHERE pr_url IS NOT NULL GROUP BY pr_url)`,
    )
    .orderBy(desc(claudeSessions.id));
}

/** A page of sessions across all tasks and PR reviews, newest first, with the task title, for the sessions page. */
/** `since` (ISO) keeps sessions Claude was active in from then on: last activity, or creation if it never ran. */
export async function listRecentSessions(
  limit: number,
  offset: number,
  since: string | null = null,
): Promise<{ rows: (SessionRow & { taskTitle: string | null })[]; total: number }> {
  const where = since ? sql`coalesce(${claudeSessions.claudeUpdatedAt}, ${claudeSessions.createdAt}) >= ${since}` : undefined;
  const rows = await db
    .select({ session: claudeSessions, taskTitle: tasks.title })
    .from(claudeSessions)
    .leftJoin(tasks, eq(tasks.id, claudeSessions.taskId))
    .where(where)
    .orderBy(desc(claudeSessions.id))
    .limit(limit)
    .offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(claudeSessions).where(where);
  return { rows: rows.map((r) => ({ ...r.session, taskTitle: r.taskTitle })), total: count };
}

/** Chores that QA on the repository's one dev stack: one task at a time per repository. */
const DEV_STACK_CHORES = ["ai-qa"];

/** Refuse a dev-stack chore while another task's run or stack holds the repository's stack. */
async function assertDevStackFree(taskIds: number[], repositoryId: number): Promise<void> {
  const [other] = await db
    .select({ taskId: claudeSessions.taskId })
    .from(claudeSessions)
    .where(
      and(
        eq(claudeSessions.repositoryId, repositoryId),
        inArray(claudeSessions.choreKey, DEV_STACK_CHORES),
        inArray(claudeSessions.state, ACTIVE_STATES),
      ),
    )
    .limit(1);
  if (other) throw new AppError(`AI QA is already running on task ${other.taskId}`, 409, "DEV_STACK_BUSY");
  const { stack } = await getDevStackStatus({ taskId: taskIds[0] });
  const owners = stack ? [stack.taskId, ...stack.mergedTaskIds] : [];
  if (stack && !taskIds.some((id) => owners.includes(id))) {
    throw new AppError(`Dev stack belongs to ${stack.branch}`, 409, "DEV_STACK_BUSY");
  }
}

async function findActiveSession(taskId: number): Promise<SessionRow | null> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(and(coversTasks([taskId]), inArray(claudeSessions.state, ACTIVE_STATES)))
    .limit(1);
  return rows[0] ?? null;
}

/** Tasks with an active session, their own or a bulk run's they are linked into. */
export async function activeTaskIds(): Promise<Set<number>> {
  const rows = await db
    .select({ id: claudeSessions.id, taskId: claudeSessions.taskId })
    .from(claudeSessions)
    .where(inArray(claudeSessions.state, ACTIVE_STATES));
  const links = await sessionLinks(rows.map((r) => r.id));
  return new Set(rows.flatMap((r) => [r.taskId, ...(links.get(r.id) ?? []).map((l) => l.taskId)]).filter((id) => id !== null));
}

export type SessionTrigger = "auto" | "manual";

export interface ChoreSessionInput {
  /** Replaces the chore's own prompt, e.g. the command plus hand-typed context. */
  prompt?: string | null;
  model?: string | null;
  effort?: string | null;
  /** Who started it: the chore scheduler or a person (default). */
  trigger?: SessionTrigger;
  /** The task state the chore was started on; the scheduler won't restart it on the same state. */
  triggerFingerprint?: string | null;
  /** The other tasks of a bulk chore run, linked to the session. */
  withTaskIds?: number[];
}

/**
 * Validate and record a session start, then continue in the background.
 * Returns the row in `preparing`.
 */
export async function startChoreSession(
  taskId: number,
  choreKey: string,
  input: ChoreSessionInput = {},
): Promise<SessionRow> {
  const chore = getChoreDefinition(choreKey);
  if (!chore || chore.key === CUSTOM_CHORE.key) {
    throw new AppError(`Unknown chore: ${choreKey}`, 400, "UNKNOWN_CHORE");
  }
  const withTaskIds = [...new Set(input.withTaskIds ?? [])].filter((id) => id !== taskId);
  if (withTaskIds.length > 0 && !isBulkChore(chore.key)) {
    throw new AppError(`${chore.name} runs on one task at a time`, 400, "VALIDATION_ERROR");
  }
  const override = input.prompt?.trim();
  return createSession(taskId, {
    chore,
    withTaskIds,
    prompt: (task) => override || resolvePrompt(chore.prompt, task, [taskId, ...withTaskIds]),
    model: input.model ?? null,
    effort: input.effort ?? null,
    trigger: input.trigger ?? "manual",
    triggerFingerprint: input.triggerFingerprint ?? null,
  });
}

export interface CustomSessionInput {
  prompt: string;
  model?: string | null;
  effort?: string | null;
}

/** Start a session from a prompt typed by hand, in the task's worktree. */
export async function startCustomSession(taskId: number, input: CustomSessionInput): Promise<SessionRow> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new AppError("prompt is required", 400, "VALIDATION_ERROR");
  return createSession(taskId, {
    chore: CUSTOM_CHORE,
    prompt: () => prompt,
    model: input.model ?? null,
    effort: input.effort ?? null,
  });
}

/**
 * Review a colleague's PR in its repo's main checkout, with no task. Any
 * number can run at once; only one per PR.
 */
export async function startReviewSession(
  prUrl: string,
  opts: { model?: string | null; effort?: string | null } = {},
): Promise<SessionRow> {
  const { url, owner, repo, number } = parsePrUrl(prUrl);

  const repository = await findRepository(owner, repo);
  if (!repository) throw new AppError(`Repository ${owner}/${repo} is not configured`, 400, "NO_REPOSITORY");
  const cwd = await resolveMainPath(repository);

  const active = await db
    .select()
    .from(claudeSessions)
    .where(and(eq(claudeSessions.prUrl, url), inArray(claudeSessions.state, ACTIVE_STATES)))
    .limit(1);
  if (active[0]) {
    throw new AppError(`Session ${active[0].id} is already ${active[0].state} on this PR`, 409, "SESSION_ACTIVE");
  }

  const timestamp = now();
  const rows = await db
    .insert(claudeSessions)
    .values({
      taskId: null,
      prUrl: url,
      repositoryId: repository.id,
      choreKey: REVIEW_CHORE.key,
      choreName: REVIEW_CHORE.name,
      prompt: `${REVIEW_CHORE.prompt} ${url}`,
      cwd,
      name: `${repository.alias ?? repository.repo}#${number} · ${REVIEW_CHORE.name}`,
      model: opts.model ?? null,
      effort: opts.effort ?? null,
      state: "preparing",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  const row = rows[0];
  broadcast("session", { taskId: null, id: row.id, state: row.state });
  void runStart(row.id);
  return row;
}

type ChoreLike = { key: string; name: string; cwd: "task" | "main"; requiresSameRepo?: boolean };
type TaskForPrompt = { id: number; jiraKey: string | null };

async function createSession(
  taskId: number,
  opts: {
    chore: ChoreLike;
    prompt: (task: TaskForPrompt) => string;
    model?: string | null;
    effort?: string | null;
    trigger?: SessionTrigger;
    triggerFingerprint?: string | null;
    withTaskIds?: number[];
  },
): Promise<SessionRow> {
  const result = await getTaskWithRepository(taskId);
  if (!result) throw new NotFoundError("Task", taskId);
  const { repository, ...task } = result;

  const { chore } = opts;
  if (!repository) throw new AppError("Task has no associated repository", 400, "NO_REPOSITORY");
  const mainPath = await resolveMainPath(repository);

  const active = await findActiveSession(taskId);
  if (active) {
    throw new AppError(`Session ${active.id} is already ${active.state} on this task`, 409, "SESSION_ACTIVE");
  }
  const links = await checkLinkedTasks(chore, repository.id, opts.withTaskIds ?? []);
  if (DEV_STACK_CHORES.includes(chore.key)) {
    await assertDevStackFree([taskId, ...links.map((l) => l.taskId)], repository.id);
  }

  let cwd = mainPath;
  if (chore.cwd === "task") {
    const worktree = await getTaskWorktreeRow(taskId);
    cwd = worktree?.path ?? worktreePathFor(mainPath, await branchForTask(task, repository));
  }

  const timestamp = now();
  const rows = await db
    .insert(claudeSessions)
    .values({
      taskId,
      repositoryId: repository.id,
      choreKey: chore.key,
      choreName: chore.name,
      prompt: opts.prompt(task),
      cwd,
      name: `${task.jiraKey ?? `#${task.id}`}${links.length > 0 ? ` +${links.length}` : ""} · ${chore.name}`,
      model: opts.model ?? null,
      effort: opts.effort ?? null,
      trigger: opts.trigger ?? "manual",
      // A manual run records the state too, so the scheduler won't redo it.
      triggerFingerprint: opts.triggerFingerprint ?? fingerprintFor(chore.key, task),
      state: "preparing",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  const row = rows[0];
  await linkSessionTasks(row.id, links);
  broadcast("session", { taskId, id: row.id, state: row.state });
  void runStart(row.id);
  return row;
}

/** The other tasks of a bulk run, each idle (and in the repository when the chore needs it), with its trigger state. */
async function checkLinkedTasks(chore: ChoreLike, repositoryId: number, taskIds: number[]): Promise<SessionTaskLink[]> {
  const links: SessionTaskLink[] = [];
  for (const id of taskIds) {
    const result = await getTaskWithRepository(id);
    if (!result) throw new NotFoundError("Task", id);
    if (chore.requiresSameRepo && result.repository?.id !== repositoryId) {
      throw new AppError(`Task ${id} is in another repository`, 400, "VALIDATION_ERROR");
    }
    const active = await findActiveSession(id);
    if (active) throw new AppError(`Session ${active.id} is already ${active.state} on task ${id}`, 409, "SESSION_ACTIVE");
    const { repository: _repository, ...task } = result;
    links.push({ taskId: id, triggerFingerprint: fingerprintFor(chore.key, task) });
  }
  return links;
}

// Capacity check + spawn are serialized so two starts cannot both pass the cap.
let spawnChain: Promise<void> = Promise.resolve();

export async function runStart(sessionId: number): Promise<void> {
  try {
    const row = await getRow(sessionId);
    if (!row || (row.state !== "preparing" && row.state !== "queued")) return;

    const chore = getChoreDefinition(row.choreKey);
    if (!chore) {
      await updateRow(sessionId, { state: "failed", error: `Unknown chore: ${row.choreKey}` });
      return;
    }

    let cwd = row.cwd;
    if (chore.cwd === "task") {
      if (row.taskId === null) {
        await updateRow(sessionId, { state: "failed", error: `${chore.name} needs a task` });
        return;
      }
      const worktree = await ensureTaskWorktree(row.taskId);
      if (worktree.state !== "ready") {
        await updateRow(sessionId, {
          state: "failed",
          error: `Worktree ${worktree.state}${worktree.error ? `: ${worktree.error}` : ""}`,
        });
        return;
      }
      cwd = worktree.path;
    }

    const task = spawnChain.then(() => spawnGated(sessionId, cwd));
    spawnChain = task.catch(() => undefined);
    await task;
  } catch (err) {
    await updateRow(sessionId, { state: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Chores never call most claude.ai connectors, yet each one's deferred tool
 * names ride on every API call. Custom prompts keep them all.
 */
const CHORE_SESSION_SETTINGS = `${import.meta.dir}/chore-session-settings.json`;

async function spawnGated(sessionId: number, cwd: string): Promise<void> {
  const row = await getRow(sessionId);
  if (!row || (row.state !== "preparing" && row.state !== "queued")) return; // stopped meanwhile

  // The cap guards task Docker stacks; a task-less PR review never boots one.
  if (row.taskId !== null && (await capacityCheck(cwd)) === "queued") {
    if (row.state !== "queued") await updateRow(sessionId, { state: "queued", cwd });
    return;
  }

  const spawned = await spawnBackground({
    cwd,
    name: row.name,
    prompt: row.prompt,
    model: row.model,
    effort: row.effort,
    settings: row.choreKey === CUSTOM_CHORE.key ? undefined : CHORE_SESSION_SETTINGS,
  });
  if ("error" in spawned) {
    await updateRow(sessionId, { state: "failed", cwd, error: spawned.error });
    return;
  }
  await updateRow(sessionId, { state: "working", cwd, shortId: spawned.shortId, error: null });
}

export async function stopSession(id: number): Promise<SessionRow> {
  const row = await getSession(id);
  if (TERMINAL_STATES.includes(row.state as ClaudeSessionState)) return row;
  if (row.shortId) await cliStop(row.shortId);
  return updateRow(id, {
    state: "stopped",
    processStoppedAt: row.shortId ? now() : null,
  });
}

/** Restart a session whose process was stopped or died, e.g. by the idle reaper. */
export async function respawnSession(id: number): Promise<SessionRow> {
  const row = await getSession(id);
  if (!row.shortId) throw new AppError("Session never started a process", 400, "NO_PROCESS");
  const result = await cliRespawn(row.shortId);
  if (result.exitCode !== 0) {
    const output = (result.stderr || result.stdout).trim();
    throw new AppError(`claude respawn failed${output ? `: ${output}` : ""}`, 502, "RESPAWN_FAILED");
  }
  return updateRow(id, { processStoppedAt: null });
}

/**
 * Mirror each session's process liveness into `processStoppedAt`, so the UI can
 * offer a respawn when the daemon lost it (reboot, CLI update, reaper) and
 * clear it when it was respawned from a terminal.
 */
export async function syncProcessLiveness(): Promise<void> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(and(isNotNull(claudeSessions.shortId), inArray(claudeSessions.state, [...POLLED_STATES, ...TERMINAL_STATES])));
  if (rows.length === 0) return;
  // `--all` lists dead sessions too, so an empty list means the CLI failed: do not guess.
  const agents = await listAgents();
  if (agents.length === 0) return;
  const alive = new Set(agents.filter((a) => a.pid).map((a) => a.id));
  for (const row of rows) {
    const running = alive.has(row.shortId!);
    if (running && row.processStoppedAt) await updateRow(row.id, { processStoppedAt: null });
    if (!running && !row.processStoppedAt) await updateRow(row.id, { processStoppedAt: now() });
  }
}

// Consecutive polls where state.json was missing, per session id.
const missingStateCounts = new Map<number, number>();

/**
 * Copy state.json into each working/blocked session; broadcast on change.
 * Done sessions with a live process are polled too: chatting with one resumes it.
 */
export async function pollActiveSessions(): Promise<void> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(
      and(
        isNotNull(claudeSessions.shortId),
        or(
          inArray(claudeSessions.state, POLLED_STATES),
          and(eq(claudeSessions.state, "done"), isNull(claudeSessions.processStoppedAt)),
        ),
      ),
    );
  if (rows.length === 0) return;

  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;

  for (const row of rows) {
    let job = await readJobState(row.shortId!);
    if (!job) {
      if (row.state === "done") continue;
      const misses = (missingStateCounts.get(row.id) ?? 0) + 1;
      missingStateCounts.set(row.id, misses);
      if (misses < MISSING_STATE_TOLERANCE) continue;
      agents ??= await listAgents();
      if (!agents.some((a) => a.id === row.shortId)) {
        missingStateCounts.delete(row.id);
        await updateRow(row.id, { state: "failed", error: "Session vanished before reporting a state" });
      }
      continue;
    }
    missingStateCounts.delete(row.id);

    // WORKAROUND (see pendingQuestion): remove once the CLI marks these prompts blocked.
    if (job.tempo === "active" && job.linkScanPath) {
      const question = await pendingQuestion(job.linkScanPath);
      if (question) job = { ...job, tempo: "blocked", needs: question };
    }

    const nextState = effectiveState(job);
    // A finished run whose idle process dies later (e.g. its worktree was reaped) stays done.
    if (row.state === "done" && nextState === "failed") {
      await updateRow(row.id, { processStoppedAt: now() });
      continue;
    }
    const updates: Partial<SessionRow> = {};
    if (nextState && nextState !== row.state) updates.state = nextState;
    if ((job.detail ?? null) !== row.detail) updates.detail = job.detail ?? null;
    if ((job.needs ?? null) !== row.needs) updates.needs = job.needs ?? null;
    const result = job.output?.result ?? null;
    if (result !== row.result) updates.result = result;
    if (job.sessionId && job.sessionId !== row.sessionId) updates.sessionId = job.sessionId;
    if (job.bridgeSessionId && job.bridgeSessionId !== row.bridgeSessionId) updates.bridgeSessionId = job.bridgeSessionId;
    if ((job.updatedAt ?? null) !== row.claudeUpdatedAt) updates.claudeUpdatedAt = job.updatedAt ?? null;
    const terminalAt = job.firstTerminalAt ?? null;
    if (terminalAt && terminalAt !== row.firstTerminalAt) updates.firstTerminalAt = terminalAt;
    if (nextState && TERMINAL_STATES.includes(nextState) && !terminalAt && !row.firstTerminalAt) {
      updates.firstTerminalAt = now();
    }

    if (Object.keys(updates).length > 0) await updateRow(row.id, updates);
    if (nextState && nextState !== row.state && TERMINAL_STATES.includes(nextState)) {
      for (const taskId of await coveredTaskIds(row)) onSessionFinished(taskId);
    }
  }
}

/**
 * The CLI writes `state: "working"` with `tempo: "idle"` for two different
 * things: a run that ended without the agent declaring an outcome, and an
 * agent parked waiting on CI or a scheduled wake-up. Only the second can
 * resume on its own, so the job's pending work tells them apart.
 *
 * `state: "blocked"` is also sticky: it survives the answer that unblocked the
 * session, so an active tempo outranks it.
 */
function effectiveState(job: JobState): ClaudeSessionState | null {
  const state = normalizeState(job.state);
  if (state && TERMINAL_STATES.includes(state)) return state;
  if (job.tempo === "blocked") return "blocked";
  if (job.tempo === "active") return "working";
  if (job.tempo === "idle" && !willResume(job)) return "done";
  return state;
}

/** Anything left that can wake the session back up without a human. */
function willResume(job: JobState): boolean {
  const flight = job.inFlight;
  if (wakePending(job.wake)) return true;
  if ((flight?.tasks ?? 0) - (flight?.drainableMonitors ?? 0) > 0) return true;
  if ((flight?.queued ?? 0) > 0) return true;
  return (flight?.kinds ?? []).includes("session_cron");
}

function wakePending(wake: JobState["wake"]): boolean {
  if (!wake) return false;
  const at = typeof wake.at === "string" ? Date.parse(wake.at) : wake.at;
  return at === undefined || !Number.isFinite(at) || at > Date.now();
}

function normalizeState(state: string | undefined): ClaudeSessionState | null {
  switch (state) {
    case "working":
    case "blocked":
    case "done":
    case "failed":
    case "stopped":
      return state;
    default:
      return null;
  }
}

/**
 * Stop finished sessions' processes once they have been idle long enough.
 * Idle is read from state.json, not the row: a done session can still be
 * chatted with, or respawned, and the row stops tracking it once done.
 */
export async function reapIdleProcesses(): Promise<void> {
  const cutoff = new Date(Date.now() - REAP_IDLE_MS).toISOString();
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(
      and(
        inArray(claudeSessions.state, ["done", "failed"]),
        isNotNull(claudeSessions.shortId),
        isNull(claudeSessions.processStoppedAt),
        lt(claudeSessions.firstTerminalAt, cutoff),
      ),
    );
  for (const row of rows) {
    const job = await readJobState(row.shortId!);
    if (job && ((job.tempo ?? "idle") !== "idle" || (job.updatedAt ?? "") >= cutoff)) continue;
    await cliStop(row.shortId!);
    await db
      .update(claudeSessions)
      .set({ processStoppedAt: now(), updatedAt: now() })
      .where(eq(claudeSessions.id, row.id));
  }
}

/** Start queued sessions in order while capacity allows. */
export async function startQueued(): Promise<void> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(eq(claudeSessions.state, "queued"))
    .orderBy(claudeSessions.id);
  for (const row of rows) {
    await runStart(row.id);
    const after = await getRow(row.id);
    if (after?.state === "queued") break; // still no capacity
  }
}

/** Resume work interrupted by a server restart. */
export async function reconcileOnStartup(): Promise<void> {
  await reconcileWorktrees();
  const rows = await db.select().from(claudeSessions).where(eq(claudeSessions.state, "preparing"));
  for (const row of rows) void runStart(row.id);
}
