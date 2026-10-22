/**
 * Periodic sync so the pipeline advances without anyone clicking Sync: pull
 * Jira and GitHub, then run the merge watch, the move of merged tickets to
 * Ready to Prod, the merge gate and the chore scheduler on the fresh state.
 * The Sync button ends with the same after-sync
 * steps (runAfterSyncSteps), then restarts the countdown. Started from
 * startClaudeRuntime.
 */
import { syncJiraItems } from "./jira-sync";
import { syncGitHubPullRequests } from "./github-sync";
import { refreshWorktreeGitStatuses } from "./task-worktrees";
import { autoMatchAndMerge } from "./task-merge";
import { runMergeWatch } from "./merge-watch";
import { runMergeJira } from "./merge-jira";
import { runMergeGate } from "./merge-gate";
import { runChoreScheduler } from "./chore-scheduler";
import { broadcast } from "../lib/sse";
import { runSteps, type Step } from "../lib/steps";

export const SYNC_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let running = false;
let nextRunAt: string | null = null;

const SYNC_STEPS: Step[] = [
  ["jira", syncJiraItems],
  ["github", syncGitHubPullRequests],
  ["worktrees", refreshWorktreeGitStatuses],
  ["match", autoMatchAndMerge],
  ["broadcast", async () => broadcast("task")],
];

/** What every sync ends with, periodic or from the Sync button. Each step runs on its own: a failing sync still lets the gate and the chores run. */
const AFTER_SYNC_STEPS: Step[] = [
  ["merge-watch", runMergeWatch],
  ["merge-jira", runMergeJira],
  ["merge-gate", runMergeGate],
  ["chores", runChoreScheduler],
];

let afterSyncQueue: Promise<void> = Promise.resolve();

/** Run the after-sync steps, queued behind any run in progress so two never overlap. */
export function runAfterSyncSteps(): Promise<void> {
  afterSyncQueue = afterSyncQueue.then(async () => {
    await runSteps("sync", AFTER_SYNC_STEPS);
  });
  return afterSyncQueue;
}

/** One pass. */
export async function runPeriodicSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runSteps("sync", SYNC_STEPS);
    await runAfterSyncSteps();
  } finally {
    running = false;
  }
}

/** When the next periodic pass starts, or null when the scheduler is stopped. */
export function getNextSyncAt(): string | null {
  return nextRunAt;
}

function scheduleNext(delayMs: number): void {
  nextRunAt = new Date(Date.now() + delayMs).toISOString();
}

function tick(): void {
  scheduleNext(SYNC_INTERVAL_MS);
  void runPeriodicSync();
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

/** After a manual sync: the next periodic pass comes a full interval from now. Does nothing while stopped. */
export function restartSyncTimer(): void {
  if (!timer) return;
  clearTimer();
  scheduleNext(SYNC_INTERVAL_MS);
  startInterval();
}

export function stopSyncScheduler(): void {
  clearTimer();
  nextRunAt = null;
}
