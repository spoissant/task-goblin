/**
 * Timers for the AI session feature. Started once from the server entry point;
 * never imported by tests. Set TASK_GOBLIN_SCHEDULERS=0 to disable.
 */
import {
  pollActiveSessions,
  reapIdleProcesses,
  reconcileOnStartup,
  setCapacityCheck,
  setOnSessionFinished,
  startQueued,
  syncProcessLiveness,
} from "./claude-sessions";
import { ensureStackCapacity, sweepIdleStacks } from "./docker-stacks";
import { reapCompletedWorktrees } from "./task-worktrees";
import { reconcileDevStack } from "./dev-stack";
import { collectSessionUsage } from "./session-usage";
import { reconcileStandups } from "./standup";
import { syncTask } from "./task-sync";
import { startSyncScheduler, stopSyncScheduler } from "./sync-scheduler";
import { runChoreScheduler } from "./chore-scheduler";
import { broadcast } from "../lib/sse";

const POLL_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

let timers: ReturnType<typeof setInterval>[] | null = null;
let polling = false;
let sweeping = false;

export function startClaudeRuntime(): void {
  if (timers) return;
  if (process.env.TASK_GOBLIN_SCHEDULERS === "0") return;

  setCapacityCheck(ensureStackCapacity);
  // Pull the task's new Jira status, PR state and git status once its session
  // finishes, then let the next chore start without waiting for the periodic sync.
  setOnSessionFinished((taskId) => {
    syncTask(taskId)
      .then((errors) => {
        if (errors.length > 0) console.error(`[claude] post-session sync of task ${taskId}:`, errors.join("; "));
        broadcast("task", { taskId });
        return runChoreScheduler({ taskId });
      })
      .catch((err) => console.error(`[claude] post-session sync of task ${taskId} failed`, err));
  });
  startSyncScheduler();
  reconcileOnStartup().catch((err) => console.error("[claude] reconcile failed", err));
  reconcileDevStack().catch((err) => console.error("[dev-stack] reconcile failed", err));
  reconcileStandups().catch((err) => console.error("[standup] reconcile failed", err));

  const poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await pollActiveSessions();
    } catch (err) {
      console.error("[claude] poll failed", err);
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL_MS);

  const sweep = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await sweepIdleStacks();
      await reapCompletedWorktrees();
      await reapIdleProcesses();
      await syncProcessLiveness();
      await startQueued();
      await collectSessionUsage();
    } catch (err) {
      console.error("[claude] sweep failed", err);
    } finally {
      sweeping = false;
    }
  }, SWEEP_INTERVAL_MS);

  poll.unref();
  sweep.unref();
  timers = [poll, sweep];
}

export function stopClaudeRuntime(): void {
  for (const t of timers ?? []) clearInterval(t);
  timers = null;
  stopSyncScheduler();
}
