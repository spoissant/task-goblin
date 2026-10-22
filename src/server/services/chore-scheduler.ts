/**
 * Starts auto chores on their own: on the periodic sync and after a task's
 * session finishes. A chore runs once per distinct task state (its
 * fingerprint), and a few at a time; none start while a session waits for
 * a Docker slot. A bulk chore runs every task at that step of
 * a repository in one session, so only the periodic sync starts one.
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { autoPromptFor, fingerprintFor, getChores, isAutoChore, isBulkChore, parseChoreSkips } from "../lib/chores";
import { getChoreModelDefaults } from "../lib/chore-models";
import { AppError } from "../lib/errors";
import { buildRepoMap } from "../lib/queries";
import { getBoolSetting } from "../lib/settings";
import { parseDeploymentBranches } from "../lib/validation";
import { resolveChoreModel, type ChoreModelDefaults } from "@/shared/chore-models";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import { ACTIVE_STATES, activeTaskIds, startChoreSession, type SessionRow } from "./claude-sessions";
import { coversTasks, sessionLinks } from "./session-tasks";

/** Auto sessions running at once, blocked ones included. */
export const MAX_AUTO_ACTIVE = 5;
/** Auto runs of one chore on one task per rolling day, whatever its states did. */
export const MAX_AUTO_RUNS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_DEPLOY_ENV = "staging";

type TaskRow = typeof tasks.$inferSelect;
type Candidate = { choreKey: string; task: TaskRow; fingerprint: string };
type HistoryRow = Pick<SessionRow, "id" | "taskId" | "choreKey" | "trigger" | "triggerFingerprint" | "createdAt">;

/** Start the auto chores whose trigger state is new; returns how many sessions started. */
export async function runChoreScheduler(opts: { taskId?: number; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  if (!(await getBoolSetting(AUTO_CHORES_SETTING, true))) return 0;

  let capacity = await freeAutoSlots();
  if (capacity <= 0) return 0;
  // A post-session run leaves bulk chores to the periodic sync, which batches every task at that step.
  const candidates = (await loadCandidates(opts.taskId)).filter((c) => !opts.taskId || !isBulkChore(c.choreKey));
  if (candidates.length === 0) return 0;

  const history = await loadHistory(candidates.map((c) => c.task.id));
  const busy = await activeTaskIds();
  const due = candidates.filter((c) => !busy.has(c.task.id) && !shouldSkip(c, history, now));
  const defaults = await getChoreModelDefaults();
  let started = 0;
  for (const batch of toBatches(due)) {
    if (capacity <= 0) break;
    if (await start(batch, defaults)) {
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
    const key = isBulkChore(c.choreKey) ? `${c.choreKey}:${c.task.repositoryId}` : `task:${c.task.id}`;
    batches.set(key, [...(batches.get(key) ?? []), c]);
  }
  return [...batches.values()];
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
  const runs = history.filter((h) => h.taskId === candidate.task.id && h.choreKey === candidate.choreKey);
  if (runs[0]?.triggerFingerprint === candidate.fingerprint) return true;
  const since = now.getTime() - DAY_MS;
  const autoRunsToday = runs.filter((h) => h.trigger === "auto" && Date.parse(h.createdAt) >= since).length;
  return autoRunsToday >= MAX_AUTO_RUNS_PER_DAY;
}

/** True when a session started; a refused start (task or dev stack busy, unknown chore) is logged and skipped. */
async function start(batch: Candidate[], defaults: ChoreModelDefaults): Promise<boolean> {
  const [{ choreKey, task, fingerprint }, ...rest] = batch;
  const ids = batch.map((c) => c.task.id);
  const on = `${choreKey} on task ${ids.join(", ")}`;
  try {
    await startChoreSession(task.id, choreKey, {
      prompt: autoPromptFor(choreKey, task, ids),
      ...resolveChoreModel(defaults, choreKey),
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
