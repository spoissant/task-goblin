/**
 * The sync pass, so the pipeline advances without anyone clicking Sync: pull
 * Jira and GitHub, then run the merge watch, the move of merged tickets to
 * Ready to Prod, the merge gate and the chore scheduler on the fresh state.
 * It runs every 5 minutes (started from startClaudeRuntime; skipped while auto
 * chores are stopped) and on POST /sync, which then restarts the countdown. One pass at a time: a call while one runs
 * gets that pass's result.
 */
import { syncJiraItems } from "./jira-sync";
import { syncGitHubPullRequests } from "./github-sync";
import { refreshWorktreeGitStatuses } from "./task-worktrees";
import { runMergeWatch } from "./merge-watch";
import { runMergeJira } from "./merge-jira";
import { runMergeGate } from "./merge-gate";
import { runChoreScheduler } from "./chore-scheduler";
import { broadcast } from "../lib/sse";
import { getBoolSetting } from "../lib/settings";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import { runSteps, type Step } from "../lib/steps";
import type { SyncRunResult } from "@/shared/types";

export const SYNC_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let nextRunAt: string | null = null;
let pass: Promise<SyncRunResult> | null = null;

/** Each step runs on its own: a failing sync still lets the gate and the chores run. */
async function runPass(): Promise<SyncRunResult> {
  const result: SyncRunResult = { jira: null, github: null, errors: [] };
  const steps: Step[] = [
    ["jira", async () => { result.jira = await syncJiraItems(); }],
    ["github", async () => { result.github = await syncGitHubPullRequests(); }],
    ["worktrees", refreshWorktreeGitStatuses],
    ["broadcast", async () => broadcast("task")],
    ["merge-watch", runMergeWatch],
    ["merge-jira", runMergeJira],
    ["merge-gate", runMergeGate],
    ["chores", runChoreScheduler],
  ];
  result.errors = await runSteps("sync", steps);
  return result;
}

/** One pass, or the one already running. */
function runSync(): Promise<SyncRunResult> {
  pass ??= runPass().finally(() => {
    pass = null;
  });
  return pass;
}

/** POST /sync: a pass (or the one running), then the next periodic pass comes a full interval later. */
export async function syncNow(): Promise<SyncRunResult> {
  const result = await runSync();
  restartSyncTimer();
  return result;
}

/** When the next periodic pass starts, or null when the scheduler is stopped. */
export function getNextSyncAt(): string | null {
  return nextRunAt;
}

function scheduleNext(delayMs: number): void {
  nextRunAt = new Date(Date.now() + delayMs).toISOString();
}

/** The periodic pass is skipped while the Tasks page's play/stop button has auto chores stopped; POST /sync still runs. */
function tick(): void {
  scheduleNext(SYNC_INTERVAL_MS);
  void getBoolSetting(AUTO_CHORES_SETTING, true).then((enabled) => (enabled ? runSync() : undefined));
}

function startInterval(): void {
  const interval = setInterval(tick, SYNC_INTERVAL_MS);
  interval.unref();
  timer = interval;
}

function clearTimer(): void {
  if (!timer) return;
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}

export function startSyncScheduler(): void {
  if (timer) return;
  scheduleNext(FIRST_RUN_DELAY_MS);
  const first = setTimeout(() => {
    tick();
    startInterval();
  }, FIRST_RUN_DELAY_MS);
  first.unref();
  timer = first;
}

/** The next periodic pass comes a full interval from now. Does nothing while stopped. */
function restartSyncTimer(): void {
  if (!timer) return;
  clearTimer();
  scheduleNext(SYNC_INTERVAL_MS);
  startInterval();
}

export function stopSyncScheduler(): void {
  clearTimer();
  nextRunAt = null;
}
