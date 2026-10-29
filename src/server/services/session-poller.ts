/**
 * Follows started sessions through the CLI: copies each job's state file into
 * its row, mirrors whether its process is alive, and stops processes idle
 * long after their session finished. claude-runtime's timers drive it.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions } from "../../db/schema";
import { now } from "../lib/timestamp";
import type { ClaudeSessionState } from "../../shared/types";
import { TERMINAL_STATES, effectiveState, listAgents, readJobState, stopSession, type JobState } from "./claude-cli";
import { updateSession, type SessionRow } from "./claude-sessions";
import { coveredTaskIds } from "./session-tasks";

const POLLED_STATES: ClaudeSessionState[] = ["working", "blocked"];
// Finished states still polled while their process is alive: chatting or a respawn resumes them.
const RESUMABLE_STATES: ClaudeSessionState[] = ["done", "stopped"];
const MISSING_STATE_TOLERANCE = 6; // poll ticks before a missing state.json is treated as a vanished session
const REAP_IDLE_MS = 10 * 60 * 1000;

type SessionFinishedHook = (taskId: number) => void;
let onSessionFinished: SessionFinishedHook = () => {};

/** Called when a task's session reaches a terminal state; the runtime syncs the task here. */
export function setOnSessionFinished(fn: SessionFinishedHook): void {
  onSessionFinished = fn;
}

/**
 * Mirror each session's process liveness into `processStoppedAt`, so the UI can
 * offer a respawn when the daemon lost it (reboot, CLI update, reaper) and
 * clear it when it was respawned from a terminal.
 */
export async function syncProcessLiveness(): Promise<void> {
  const rows = await db.select().from(claudeSessions).where(isNotNull(claudeSessions.shortId));
  if (rows.length === 0) return;
  // `--all` lists dead sessions too, so an empty list means the CLI failed: do not guess.
  const agents = await listAgents();
  if (agents.length === 0) return;
  const alive = new Set(agents.filter((a) => a.pid).map((a) => a.id));
  for (const row of rows) {
    const running = alive.has(row.shortId!);
    if (running && row.processStoppedAt) await updateSession(row.id, { processStoppedAt: null });
    if (!running && !row.processStoppedAt) await updateSession(row.id, { processStoppedAt: now() });
  }
}

// Consecutive polls where state.json was missing, per session id.
const missingStateCounts = new Map<number, number>();

/**
 * Copy state.json into each working/blocked session; broadcast on change.
 * Done and stopped sessions with a live process are polled too: chatting or a respawn resumes them.
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
          and(inArray(claudeSessions.state, RESUMABLE_STATES), isNull(claudeSessions.processStoppedAt)),
        ),
      ),
    );
  if (rows.length === 0) return;

  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;

  for (const row of rows) {
    const job = await readJobState(row.shortId!);
    if (!job) {
      if (RESUMABLE_STATES.includes(row.state as ClaudeSessionState)) continue;
      const misses = (missingStateCounts.get(row.id) ?? 0) + 1;
      missingStateCounts.set(row.id, misses);
      if (misses < MISSING_STATE_TOLERANCE) continue;
      agents ??= await listAgents();
      if (!agents.some((a) => a.id === row.shortId)) {
        missingStateCounts.delete(row.id);
        await updateSession(row.id, { state: "failed", error: "Session vanished before reporting a state" });
      }
      continue;
    }
    missingStateCounts.delete(row.id);
    await applyJobState(row, job);
  }
}

/** Copy one job's state into its row; a session that just finished hands each of its tasks to the runtime. */
async function applyJobState(row: SessionRow, job: JobState): Promise<void> {
  const nextState = effectiveState(job);
  // A finished run whose idle process dies later (e.g. its worktree was reaped) keeps its state.
  if (RESUMABLE_STATES.includes(row.state as ClaudeSessionState) && nextState === "failed") {
    await updateSession(row.id, { processStoppedAt: now() });
    return;
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

  if (Object.keys(updates).length > 0) await updateSession(row.id, updates);
  if (nextState && nextState !== row.state && TERMINAL_STATES.includes(nextState)) {
    for (const taskId of await coveredTaskIds(row)) onSessionFinished(taskId);
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
    await stopSession(row.shortId!);
    await db
      .update(claudeSessions)
      .set({ processStoppedAt: now(), updatedAt: now() })
      .where(eq(claudeSessions.id, row.id));
  }
}
