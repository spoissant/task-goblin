import { runCommand, type CommandResult } from "./process";

/**
 * Worktrunk (`wt`) CLI helpers. Task worktrees are created and removed with
 * wt so repositories that define hooks in `.config/wt.toml` get their own
 * setup and teardown; a repository without that file just gets a plain
 * worktree.
 */

/** Run wt through a login zsh so it resolves on the same PATH as a terminal. */
function runWt(cwd: string, args: string[], timeoutMs?: number): Promise<CommandResult> {
  return runCommand("/bin/zsh", ["-lc", 'command wt "$@"', "wt", ...args], { cwd, timeoutMs });
}

export interface WtSwitchResult {
  result: CommandResult;
  /** Absolute worktree path reported by wt; null when the switch failed. */
  path: string | null;
}

/**
 * Create (or find) the worktree for `branch` without running hooks, so setup
 * can be re-run on its own after a failure. `base` creates the branch from it.
 */
export async function wtSwitch(mainPath: string, branch: string, base?: string): Promise<WtSwitchResult> {
  const args = ["switch", branch, "--no-hooks", "--no-cd", "--yes", "--format", "json"];
  if (base) args.push("--create", "--base", base);
  const result = await runWt(mainPath, args);
  if (result.exitCode !== 0) return { result, path: null };
  try {
    const parsed = JSON.parse(result.stdout) as { path?: string };
    return { result, path: parsed.path ?? null };
  } catch {
    return { result, path: null };
  }
}

/** Run the repository's pre-start hooks inside the worktree. */
export function wtPreStart(worktreePath: string, timeoutMs: number): Promise<CommandResult> {
  return runWt(worktreePath, ["hook", "pre-start", "--yes"], timeoutMs);
}

/**
 * Remove the worktree at `worktreePath` (pre-remove hooks run first). The
 * branch is deleted only when merged; `force` drops uncommitted changes.
 */
export function wtRemove(
  mainPath: string,
  worktreePath: string,
  force: boolean,
  timeoutMs: number,
): Promise<CommandResult> {
  const args = ["-C", worktreePath, "remove", "--foreground", "--yes"];
  if (force) args.push("--force");
  return runWt(mainPath, args, timeoutMs);
}
