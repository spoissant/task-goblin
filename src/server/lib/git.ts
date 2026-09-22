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

export interface WorktreeEntry {
  path: string;
  branch: string | null; // null when detached
}

/** Parse `git worktree list --porcelain` into path/branch pairs. */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null };
      entries.push(current);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return entries;
}

export async function worktreeList(mainPath: string): Promise<WorktreeEntry[]> {
  const result = await runGit(mainPath, ["worktree", "list", "--porcelain"]);
  if (result.exitCode !== 0) return [];
  return parseWorktreeList(result.stdout);
}

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

/**
 * Add a worktree at `path`. Either checks out an existing local branch,
 * creates a tracking branch from origin, or detaches at a ref.
 */
export async function worktreeAdd(
  mainPath: string,
  path: string,
  target: { branch: string } | { newBranch: string; from: string } | { detachAt: string },
): Promise<CommandResult> {
  const args = ["worktree", "add"];
  if ("detachAt" in target) {
    args.push("--detach", path, target.detachAt);
  } else if ("newBranch" in target) {
    args.push("--track", "-b", target.newBranch, path, target.from);
  } else {
    args.push(path, target.branch);
  }
  return runGit(mainPath, args);
}

export async function worktreeRemove(mainPath: string, path: string, force: boolean): Promise<CommandResult> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  return runGit(mainPath, args);
}

/** Number of changed or untracked files; null when git status fails. */
export async function changedFileCount(repoPath: string): Promise<number | null> {
  const result = await runGit(repoPath, ["status", "--porcelain=v1"]);
  if (result.exitCode !== 0) return null;
  if (result.stdout === "") return 0;
  return result.stdout.split("\n").filter(Boolean).length;
}
