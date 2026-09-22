/**
 * Timers for the AI session feature. Started once from the server entry point;
 * never imported by tests. Set TASK_GOBLIN_SCHEDULERS=0 to disable.
 */
import {
  pollActiveSessions,
  reapIdleProcesses,
  reconcileOnStartup,
  setCapacityCheck,
  startQueued,
} from "./claude-sessions";
import { ensureStackCapacity, sweepIdleStacks } from "./docker-stacks";
import { reapCompletedWorktrees } from "./task-worktrees";

const POLL_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

let timers: ReturnType<typeof setInterval>[] | null = null;
let polling = false;
let sweeping = false;

export function startClaudeRuntime(): void {
  if (timers) return;
  if (process.env.TASK_GOBLIN_SCHEDULERS === "0") return;

  setCapacityCheck(ensureStackCapacity);
  reconcileOnStartup().catch((err) => console.error("[claude] reconcile failed", err));

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
      await startQueued();
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
}
