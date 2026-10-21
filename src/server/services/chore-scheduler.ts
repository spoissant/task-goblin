/**
 * Starts auto chores on their own: on the periodic sync and after a task's
 * session finishes. A chore runs once per distinct task state (its
 * fingerprint), in daytime only, and a couple at a time so start-task and
 * manual runs keep a Docker slot.
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { autoPromptFor, fingerprintFor, getChores, isAutoChore, parseChoreSkips } from "../lib/chores";
import { getChoreModelDefaults } from "../lib/chore-models";
import { AppError } from "../lib/errors";
import { buildRepoMap } from "../lib/queries";
import { getBoolSetting } from "../lib/settings";
import { parseDeploymentBranches } from "../lib/validation";
import { resolveChoreModel, type ChoreModelDefaults } from "@/shared/chore-models";
import { ACTIVE_STATES, startChoreSession, type SessionRow } from "./claude-sessions";

/** Auto sessions running at once; the third Docker slot stays free for start-task and manual runs. */
export const MAX_AUTO_ACTIVE = 2;
/** Auto runs of one chore on one task per rolling day, whatever its states did. */
export const MAX_AUTO_RUNS_PER_DAY = 3;
export const AUTO_CHORES_ENABLED_KEY = "auto_chores_enabled";
const AUTO_WINDOW_HOURS = { from: 6, to: 22 }; // local time
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_DEPLOY_ENV = "staging";

type TaskRow = typeof tasks.$inferSelect;
type Candidate = { choreKey: string; task: TaskRow; fingerprint: string };
type HistoryRow = Pick<SessionRow, "taskId" | "choreKey" | "trigger" | "triggerFingerprint" | "createdAt">;

/** Auto chores only start between 06:00 and 22:00 local time. */
export function isWithinAutoWindow(d = new Date()): boolean {
  const hour = d.getHours();
  return hour >= AUTO_WINDOW_HOURS.from && hour < AUTO_WINDOW_HOURS.to;
}

/** Start the auto chores whose trigger state is new; returns how many sessions started. */
export async function runChoreScheduler(opts: { taskId?: number; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  if (!(await getBoolSetting(AUTO_CHORES_ENABLED_KEY, true)) || !isWithinAutoWindow(now)) return 0;

  let capacity = await freeAutoSlots();
  if (capacity <= 0) return 0;
  const candidates = await loadCandidates(opts.taskId);
  if (candidates.length === 0) return 0;

  const history = await loadHistory(candidates.map((c) => c.task.id));
  const defaults = await getChoreModelDefaults();
  let started = 0;
  for (const candidate of candidates) {
    if (capacity <= 0) break;
    if (shouldSkip(candidate, history, now)) continue;
    if (await start(candidate, defaults)) {
      started++;
      capacity--;
    }
  }
  return started;
}

/** Auto slots left; none while any session waits for a Docker slot. */
async function freeAutoSlots(): Promise<number> {
  const active = await db
    .select({ trigger: claudeSessions.trigger, state: claudeSessions.state })
    .from(claudeSessions)
    .where(inArray(claudeSessions.state, ACTIVE_STATES));
  if (active.some((s) => s.state === "queued")) return 0;
  return MAX_AUTO_ACTIVE - active.filter((s) => s.trigger === "auto").length;
}

/** The first auto chore of each task the chore list suggests, with the task row it runs on. */
async function loadCandidates(taskId?: number): Promise<Candidate[]> {
  const entries = (await getChores({ taskId })).filter((e) => isAutoChore(e.key));
  if (entries.length === 0) return [];
  const ids = [...new Set(entries.map((e) => e.task.id))];
  const rows = await db.select().from(tasks).where(inArray(tasks.id, ids));
  const taskById = new Map(rows.map((t) => [t.id, t]));
  const repoMap = await buildRepoMap(rows);

  const seen = new Set<number>();
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const task = taskById.get(entry.task.id);
    if (!task || seen.has(task.id)) continue;
    seen.add(task.id);
    if (parseChoreSkips(task.choreSkips).auto) continue;
    if (entry.key === "deploy-test-env" && !repoHasAutoDeployEnv(task, repoMap)) continue;
    const fingerprint = fingerprintFor(entry.key, task);
    if (fingerprint !== null) candidates.push({ choreKey: entry.key, task, fingerprint });
  }
  return candidates;
}

function repoHasAutoDeployEnv(task: TaskRow, repoMap: Awaited<ReturnType<typeof buildRepoMap>>): boolean {
  const repo = task.repositoryId ? repoMap.get(task.repositoryId) : undefined;
  return parseDeploymentBranches(repo?.deploymentBranches ?? null).includes(AUTO_DEPLOY_ENV);
}

/** Every session of the candidate tasks, newest first. */
async function loadHistory(taskIds: number[]): Promise<HistoryRow[]> {
  return db
    .select({
      taskId: claudeSessions.taskId,
      choreKey: claudeSessions.choreKey,
      trigger: claudeSessions.trigger,
      triggerFingerprint: claudeSessions.triggerFingerprint,
      createdAt: claudeSessions.createdAt,
    })
    .from(claudeSessions)
    .where(inArray(claudeSessions.taskId, taskIds))
    .orderBy(desc(claudeSessions.id));
}

/** Already ran on this state (by anyone, whatever the outcome), or ran too often today. */
function shouldSkip(candidate: Candidate, history: HistoryRow[], now: Date): boolean {
  const runs = history.filter((h) => h.taskId === candidate.task.id && h.choreKey === candidate.choreKey);
  if (runs[0]?.triggerFingerprint === candidate.fingerprint) return true;
  const since = now.getTime() - DAY_MS;
  const autoRunsToday = runs.filter((h) => h.trigger === "auto" && Date.parse(h.createdAt) >= since).length;
  return autoRunsToday >= MAX_AUTO_RUNS_PER_DAY;
}

/** True when a session started; a refused start (task busy, unknown chore) is logged and skipped. */
async function start(candidate: Candidate, defaults: ChoreModelDefaults): Promise<boolean> {
  const { choreKey, task, fingerprint } = candidate;
  try {
    await startChoreSession(task.id, choreKey, {
      prompt: autoPromptFor(choreKey, task),
      ...resolveChoreModel(defaults, choreKey),
      trigger: "auto",
      triggerFingerprint: fingerprint,
    });
    console.error(`[scheduler] started ${choreKey} on task ${task.id}`);
    return true;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    console.error(`[scheduler] skipped ${choreKey} on task ${task.id}: ${err.message}`);
    return false;
  }
}
