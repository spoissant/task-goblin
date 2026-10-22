/**
 * The dev stack's process seam: how its boot command is spawned, checked and
 * killed, and how the booted site is probed. Tests swap it out with
 * setDevStackRuntime (dev-stack.ts).
 */
import { closeSync, openSync } from "fs";
import { expandPath } from "../lib/path";
import { runCommand } from "../lib/process";

export interface DevStackRuntime {
  /** Start the long-running boot command with stdout/stderr appended to `logPath`. */
  spawn(cwd: string, command: string, logPath: string): { pid: number; exited: Promise<number> };
  isAlive(pid: number): boolean;
  /**
   * Best-effort SIGTERM (then SIGKILL) of pid and all its descendants.
   * `bin/dev start` is a shell script whose dev-server supervisor respawns
   * children on crash and doesn't forward signals (and nx runs Storybook as
   * a child), so killing just the recorded pid leaves the real work running;
   * this walks the whole tree.
   */
  killTree(pid: number): Promise<void>;
  /** HTTP status of the booted site, or null when nothing answers. */
  probe(url: string): Promise<number | null>;
  /** Delay between readiness checks. */
  readyPollMs: number;
  /** How long to wait for the main stack's containers to stop. */
  downTimeoutMs: number;
}

const KILL_TREE_GRACE_MS = 2_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function directChildren(pid: number): Promise<number[]> {
  const result = await runCommand("pgrep", ["-P", String(pid)], { cwd: process.cwd() });
  return result.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** pid and every descendant, breadth-first. */
async function processTree(pid: number): Promise<number[]> {
  const all = [pid];
  let frontier = [pid];
  while (frontier.length > 0) {
    const children = (await Promise.all(frontier.map(directChildren))).flat();
    if (children.length === 0) break;
    all.push(...children);
    frontier = children;
  }
  return all;
}

export const defaultRuntime: DevStackRuntime = {
  spawn(cwd, command, logPath) {
    const fd = openSync(logPath, "a");
    const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
      cwd: expandPath(cwd),
      stdout: fd,
      stderr: fd,
      stdin: "ignore",
    });
    const exited = proc.exited.finally(() => closeSync(fd));
    return { pid: proc.pid, exited };
  },
  isAlive: pidAlive,
  async killTree(pid) {
    const pids = await processTree(pid);
    for (const p of pids) {
      try {
        process.kill(p, "SIGTERM");
      } catch {
        // already gone
      }
    }
    await Bun.sleep(KILL_TREE_GRACE_MS);
    for (const p of pids) {
      if (pidAlive(p)) {
        try {
          process.kill(p, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  },
  async probe(url) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      return res.status;
    } catch {
      return null;
    }
  },
  readyPollMs: 3_000,
  downTimeoutMs: 3 * 60 * 1000,
};
