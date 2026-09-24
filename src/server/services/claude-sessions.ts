/**
 * Background Claude Code sessions per task: one fresh session per chore run,
 * never resumed. Continuity lives in the worktree, Task Goblin and the PR.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getTaskWithRepository } from "../lib/queries";
import { CUSTOM_CHORE, getChoreDefinition, resolvePrompt } from "../lib/chores";
import { broadcast } from "../lib/sse";
import type { ClaudeSession, ClaudeSessionState } from "../../shared/types";
import {
  listAgents,
  pendingQuestion,
  readJobState,
  sessionLink,
  spawnBackground,
  stopSession as cliStop,
  type JobState,
} from "./claude-cli";
import {
  ensureTaskWorktree,
  getTaskWorktreeRow,
  reconcileWorktrees,
  resolveMainPath,
  worktreeKeyFor,
  worktreePathFor,
} from "./task-worktrees";

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

export function toApi(row: SessionRow): ClaudeSession {
  return { ...row, state: row.state as ClaudeSessionState, link: sessionLink(row.bridgeSessionId) };
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

export async function listTaskSessions(taskId: number): Promise<SessionRow[]> {
  return db.select().from(claudeSessions).where(eq(claudeSessions.taskId, taskId)).orderBy(desc(claudeSessions.id));
}

/** Newest session per task, for the tasks table. */
export async function listLatestSessions(): Promise<SessionRow[]> {
  return db
    .select()
    .from(claudeSessions)
    .where(sql`${claudeSessions.id} IN (SELECT MAX(id) FROM claude_sessions GROUP BY task_id)`)
    .orderBy(desc(claudeSessions.id));
}

/** Newest sessions across all tasks, with the task title, for the sessions page. */
export async function listRecentSessions(limit: number): Promise<(SessionRow & { taskTitle: string })[]> {
  const rows = await db
    .select({ session: claudeSessions, taskTitle: tasks.title })
    .from(claudeSessions)
    .innerJoin(tasks, eq(tasks.id, claudeSessions.taskId))
    .orderBy(desc(claudeSessions.id))
    .limit(limit);
  return rows.map((r) => ({ ...r.session, taskTitle: r.taskTitle }));
}

async function findActiveSession(taskId: number): Promise<SessionRow | null> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(and(eq(claudeSessions.taskId, taskId), inArray(claudeSessions.state, ACTIVE_STATES)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ChoreSessionInput {
  /** Replaces the chore's own prompt, e.g. the command plus hand-typed context. */
  prompt?: string | null;
  model?: string | null;
  effort?: string | null;
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
  const override = input.prompt?.trim();
  return createSession(taskId, {
    chore,
    prompt: (task) => override || resolvePrompt(chore.prompt, task),
    model: input.model ?? null,
    effort: input.effort ?? null,
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

type ChoreLike = { key: string; name: string; cwd: "task" | "main" };
type TaskForPrompt = { id: number; jiraKey: string | null };

async function createSession(
  taskId: number,
  opts: {
    chore: ChoreLike;
    prompt: (task: TaskForPrompt) => string;
    model?: string | null;
    effort?: string | null;
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

  let cwd = mainPath;
  if (chore.cwd === "task") {
    const worktree = await getTaskWorktreeRow(taskId);
    cwd = worktree?.path ?? worktreePathFor(mainPath, worktreeKeyFor(task));
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
      name: `${task.jiraKey ?? `#${task.id}`} · ${chore.name}`,
      model: opts.model ?? null,
      effort: opts.effort ?? null,
      state: "preparing",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  const row = rows[0];
  broadcast("session", { taskId, id: row.id, state: row.state });
  void runStart(row.id);
  return row;
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

async function spawnGated(sessionId: number, cwd: string): Promise<void> {
  const row = await getRow(sessionId);
  if (!row || (row.state !== "preparing" && row.state !== "queued")) return; // stopped meanwhile

  if ((await capacityCheck(cwd)) === "queued") {
    if (row.state !== "queued") await updateRow(sessionId, { state: "queued", cwd });
    return;
  }

  const spawned = await spawnBackground({
    cwd,
    name: row.name,
    prompt: row.prompt,
    model: row.model,
    effort: row.effort,
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

// Consecutive polls where state.json was missing, per session id.
const missingStateCounts = new Map<number, number>();

/** Copy state.json into each working/blocked session; broadcast on change. */
export async function pollActiveSessions(): Promise<void> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(and(inArray(claudeSessions.state, POLLED_STATES), isNotNull(claudeSessions.shortId)));
  if (rows.length === 0) return;

  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;

  for (const row of rows) {
    let job = await readJobState(row.shortId!);
    if (!job) {
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
    if (terminalAt !== row.firstTerminalAt) updates.firstTerminalAt = terminalAt;
    if (nextState && TERMINAL_STATES.includes(nextState) && !terminalAt && !row.firstTerminalAt) {
      updates.firstTerminalAt = now();
    }

    if (Object.keys(updates).length > 0) await updateRow(row.id, updates);
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

/** Stop finished sessions' processes once they have been idle long enough. */
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
