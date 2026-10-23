/**
 * Timers for the AI session feature. Started once from the server entry point;
 * never imported by tests. Set TASK_GOBLIN_SCHEDULERS=0 to disable.
 */
import { reconcileOnStartup, startQueued } from "./claude-sessions";
import { pollActiveSessions, reapIdleProcesses, setOnSessionFinished, syncProcessLiveness } from "./session-poller";
import { sweepIdleStacks } from "./docker-stacks";
import { reapCompletedWorktrees } from "./task-worktrees";
import { reconcileDevStack } from "./dev-stack";
import { collectSessionUsage } from "./session-usage";
import { reconcileStandups } from "./standup";
import { syncTask } from "./task-sync";
import { startSyncScheduler } from "./sync-scheduler";
import { getBoolSetting } from "../lib/settings";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import { runChoreScheduler } from "./chore-scheduler";
import { broadcast } from "../lib/sse";
import { runSteps, type Step } from "../lib/steps";

const POLL_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

/** The minute sweep; each step runs on its own, so one that throws doesn't hold back the rest. */
const SWEEP_STEPS: Step[] = [
  ["idle-stacks", sweepIdleStacks],
  ["worktree-reap", reapCompletedWorktrees],
  ["process-reap", reapIdleProcesses],
  ["liveness", syncProcessLiveness],
  ["queued", startQueued],
  ["usage", collectSessionUsage],
];

let polling = false;
let sweeping = false;

export function startClaudeRuntime(): void {
  if (process.env.TASK_GOBLIN_SCHEDULERS === "0") return;

  // Pull the task's new Jira status, PR state and git status once its session
  // finishes, then let the next chore start without waiting for the periodic sync.
  setOnSessionFinished((taskId) => {
    syncTask(taskId)
      .then((errors) => {
        if (errors.length > 0) console.error(`[claude] post-session sync of task ${taskId}:`, errors.join("; "));
        broadcast("task");
        return runChoreScheduler({ taskId });
      })
      .catch((err) => console.error(`[claude] post-session sync of task ${taskId} failed`, err));
  });
  getBoolSetting(AUTO_CHORES_SETTING, true)
    .then((enabled) => enabled && startSyncScheduler())
    .catch((err) => console.error("[sync] scheduler start failed", err));
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
      await runSteps("runtime", SWEEP_STEPS);
    } finally {
      sweeping = false;
    }
  }, SWEEP_INTERVAL_MS);

  poll.unref();
  sweep.unref();
}
