/**
 * Periodic sync so the pipeline advances without anyone clicking Sync: pull
 * Jira and GitHub, then run the merge watch, the merge gate and the chore
 * scheduler on the fresh state. Started from startClaudeRuntime.
 */
import { syncJiraItems } from "./jira-sync";
import { syncGitHubPullRequests } from "./github-sync";
import { refreshWorktreeGitStatuses } from "./task-worktrees";
import { autoMatchAndMerge } from "./task-merge";
import { runMergeWatch } from "./merge-watch";
import { runMergeGate } from "./merge-gate";
import { runChoreScheduler } from "./chore-scheduler";
import { broadcast } from "../lib/sse";

export const SYNC_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let running = false;

type Step = [name: string, run: () => Promise<unknown>];

const STEPS: Step[] = [
  ["jira", syncJiraItems],
  ["github", syncGitHubPullRequests],
  ["worktrees", refreshWorktreeGitStatuses],
  ["match", autoMatchAndMerge],
  ["broadcast", async () => broadcast("task")],
  ["merge-watch", runMergeWatch],
  ["merge-gate", runMergeGate],
  ["chores", runChoreScheduler],
];

/** One pass. Each step is isolated: a failing sync still lets the gate and the chores run. */
export async function runPeriodicSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const [name, run] of STEPS) {
      try {
        await run();
      } catch (err) {
        console.error(`[sync] ${name} failed`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    running = false;
  }
}

export function startSyncScheduler(): void {
  if (timer) return;
  const first = setTimeout(() => {
    void runPeriodicSync();
    const interval = setInterval(() => void runPeriodicSync(), SYNC_INTERVAL_MS);
    interval.unref();
    timer = interval;
  }, FIRST_RUN_DELAY_MS);
  first.unref();
  timer = first;
}

export function stopSyncScheduler(): void {
  if (!timer) return;
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}
