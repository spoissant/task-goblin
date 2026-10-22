/**
 * Starts auto chores on their own: on the periodic sync and after a task's
 * session finishes. A chore runs once per distinct task state (its
 * fingerprint), and a few at a time; none start while a session waits for
 * a Docker slot. A bulk chore runs every task at that step of
 * a repository in one session, so only the periodic sync starts one.
 */
import { desc } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { fingerprintFor, matchChores, type Chore } from "../lib/chores";
import { AppError } from "../lib/errors";
import { getBoolSetting } from "../lib/settings";
import { isAutoPaused } from "@/shared/chore-skips";
import { resolvePrompt } from "@/shared/chores";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import { startChoreSession, type SessionRow } from "./claude-sessions";
import { activeTaskIds, coversTasks, isActive, sessionLinks } from "./session-tasks";

/** Auto sessions running at once, blocked ones included. */
export const MAX_AUTO_ACTIVE = 5;
/** Auto runs of one chore on one task per rolling day, whatever its states did. */
export const MAX_AUTO_RUNS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

type TaskRow = typeof tasks.$inferSelect;
type Candidate = { chore: Chore; task: TaskRow; fingerprint: string };
type HistoryRow = Pick<SessionRow, "id" | "taskId" | "choreKey" | "trigger" | "triggerFingerprint" | "createdAt">;
type SchedulerOptions = { taskId?: number; now?: Date };

let queue: Promise<unknown> = Promise.resolve();

/**
 * Start the auto chores whose trigger state is new; returns how many sessions
 * started. One run at a time, later calls queued behind it: two runs at once
 * (a post-session one and the periodic one) would both start the same chore.
 */
export function runChoreScheduler(opts: SchedulerOptions = {}): Promise<number> {
  const run = queue.then(() => schedule(opts));
  queue = run.catch(() => undefined);
  return run;
}

async function schedule(opts: SchedulerOptions): Promise<number> {
  const now = opts.now ?? new Date();
  if (!(await getBoolSetting(AUTO_CHORES_SETTING, true))) return 0;

  let capacity = await freeAutoSlots();
  if (capacity <= 0) return 0;
  // A post-session run leaves bulk chores to the periodic sync, which batches every task at that step.
  const candidates = (await loadCandidates(opts.taskId)).filter((c) => !opts.taskId || !c.chore.supportsBulk);
  if (candidates.length === 0) return 0;

  const history = await loadHistory(candidates.map((c) => c.task.id));
  const busy = await activeTaskIds();
  const due = candidates.filter((c) => !busy.has(c.task.id) && !shouldSkip(c, history, now));
  let started = 0;
  for (const batch of toBatches(due)) {
    if (capacity <= 0) break;
    if (await start(batch)) {
      started++;
      capacity--;
    }
  }
  return started;
}

/** One session per task, except a bulk chore: one per repository (every bulk auto chore requires one repository). */
function toBatches(candidates: Candidate[]): Candidate[][] {
  const batches = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.chore.supportsBulk ? `${c.chore.key}:${c.task.repositoryId}` : `task:${c.task.id}`;
    batches.set(key, [...(batches.get(key) ?? []), c]);
  }
  return [...batches.values()];
}

/** Auto slots left; none while any session waits for a Docker slot. */
async function freeAutoSlots(): Promise<number> {
  const active = await db
    .select({ trigger: claudeSessions.trigger, state: claudeSessions.state })
    .from(claudeSessions)
    .where(isActive());
  if (active.some((s) => s.state === "queued")) return 0;
  return MAX_AUTO_ACTIVE - active.filter((s) => s.trigger === "auto").length;
}

/** The first auto chore of each task the chore list suggests, unless the task pauses auto-starts or the chore skips it. */
async function loadCandidates(taskId?: number): Promise<Candidate[]> {
  const seen = new Set<number>();
  const candidates: Candidate[] = [];
  for (const { chore, task, repo } of await matchChores({ taskId })) {
    if (!chore.auto || seen.has(task.id)) continue;
    seen.add(task.id);
    if (isAutoPaused(task.choreSkips) || (chore.auto.when && !chore.auto.when(task, repo))) continue;
    const fingerprint = fingerprintFor(chore.key, task);
    if (fingerprint !== null) candidates.push({ chore, task, fingerprint });
  }
  return candidates;
}

/** Every session of the candidate tasks, newest first: a row per task it covers, with that task's trigger state. */
async function loadHistory(taskIds: number[]): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      id: claudeSessions.id,
      taskId: claudeSessions.taskId,
      choreKey: claudeSessions.choreKey,
      trigger: claudeSessions.trigger,
      triggerFingerprint: claudeSessions.triggerFingerprint,
      createdAt: claudeSessions.createdAt,
    })
    .from(claudeSessions)
    .where(coversTasks(taskIds))
    .orderBy(desc(claudeSessions.id));
  const links = await sessionLinks(rows.map((r) => r.id));
  return rows.flatMap((r) => [r, ...(links.get(r.id) ?? []).map((l) => ({ ...r, ...l }))]);
}

/** Already ran on this state (by anyone, whatever the outcome), or ran too often today. */
function shouldSkip(candidate: Candidate, history: HistoryRow[], now: Date): boolean {
  const runs = history.filter((h) => h.taskId === candidate.task.id && h.choreKey === candidate.chore.key);
  if (runs[0]?.triggerFingerprint === candidate.fingerprint) return true;
  const since = now.getTime() - DAY_MS;
  const autoRunsToday = runs.filter((h) => h.trigger === "auto" && Date.parse(h.createdAt) >= since).length;
  return autoRunsToday >= MAX_AUTO_RUNS_PER_DAY;
}

/**
 * True when a session started; a refused start (task or dev stack busy) is
 * logged and skipped. The session runs on the chore's model settings.
 */
async function start(batch: Candidate[]): Promise<boolean> {
  const [{ chore, task, fingerprint }, ...rest] = batch;
  const ids = batch.map((c) => c.task.id);
  const on = `${chore.key} on task ${ids.join(", ")}`;
  try {
    await startChoreSession(task.id, chore.key, {
      prompt: resolvePrompt(chore.auto?.prompt ?? chore.prompt, task, ids),
      trigger: "auto",
      triggerFingerprint: fingerprint,
      withTaskIds: rest.map((c) => c.task.id),
    });
    console.error(`[scheduler] started ${on}`);
    return true;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    console.error(`[scheduler] skipped ${on}: ${err.message}`);
    return false;
  }
}
