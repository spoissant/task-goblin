import { runCommand, type CommandResult } from "./process";

export async function runGit(cwd: string, args: string[]): Promise<CommandResult> {
  return runCommand("git", args, { cwd });
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const result = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error("Failed to get current branch");
  }
  return result.stdout;
}

export async function getConflictedFiles(repoPath: string): Promise<string[]> {
  const result = await runGit(repoPath, [
    "diff",
    "--name-only",
    "--diff-filter=U",
  ]);
  if (result.stdout === "") return [];
  return result.stdout.split("\n").filter(Boolean);
}

export async function abortMerge(repoPath: string): Promise<void> {
  await runGit(repoPath, ["merge", "--abort"]);
}

export async function checkoutBranch(
  repoPath: string,
  branch: string,
): Promise<void> {
  const result = await runGit(repoPath, ["checkout", branch]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to checkout branch ${branch}: ${result.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Worktree helpers (used by per-task worktrees)
// ---------------------------------------------------------------------------

export async function worktreePrune(mainPath: string): Promise<void> {
  await runGit(mainPath, ["worktree", "prune"]);
}

export async function fetchRef(mainPath: string, ref: string): Promise<CommandResult> {
  return runGit(mainPath, ["fetch", "origin", ref]);
}

export async function localBranchExists(mainPath: string, branch: string): Promise<boolean> {
  const result = await runGit(mainPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  return result.exitCode === 0;
}

export async function remoteBranchExists(mainPath: string, branch: string): Promise<boolean> {
  const result = await runGit(mainPath, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  return result.exitCode === 0;
}

/** Number of changed or untracked files; null when git status fails. */
export async function changedFileCount(repoPath: string): Promise<number | null> {
  const result = await runGit(repoPath, ["status", "--porcelain=v1"]);
  if (result.exitCode !== 0) return null;
  if (result.stdout === "") return 0;
  return result.stdout.split("\n").filter(Boolean).length;
}
