/**
 * Timers for the AI session feature. Started once from the server entry point;
 * never imported by tests. Set TASK_GOBLIN_SCHEDULERS=0 to disable.
 */
import {
  pollActiveSessions,
  reapIdleProcesses,
  reconcileOnStartup,
  startQueued,
} from "./claude-sessions";

const POLL_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

let timers: ReturnType<typeof setInterval>[] | null = null;
let polling = false;
let sweeping = false;
let sweepHook: () => Promise<void> = async () => {};

/** Slice 4 installs the Docker stack sweeper and worktree reaper here. */
export function setSweepHook(fn: () => Promise<void>): void {
  sweepHook = fn;
}

export function startClaudeRuntime(): void {
  if (timers) return;
  if (process.env.TASK_GOBLIN_SCHEDULERS === "0") return;

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
      await sweepHook();
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
