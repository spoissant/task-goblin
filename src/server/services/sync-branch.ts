import { existsSync } from "fs";
import { homedir } from "os";

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return path.replace("~", homedir());
  }
  return path;
}

export interface SyncBranchResult {
  status: "success";
  taskBranch: string;
  mainBranch: string;
  commitSha: string;
}

export interface SyncBranchConflict {
  status: "conflict";
  conflictedFiles: string[];
}

export class SyncBranchError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SyncBranchError";
  }
}

async function runGit(
  repoPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  const result = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new SyncBranchError("Failed to get current branch", "GIT_ERROR");
  }
  return result.stdout;
}

async function getConflictedFiles(repoPath: string): Promise<string[]> {
  const result = await runGit(repoPath, [
    "diff",
    "--name-only",
    "--diff-filter=U",
  ]);
  if (result.stdout === "") return [];
  return result.stdout.split("\n").filter(Boolean);
}

async function abortMerge(repoPath: string): Promise<void> {
  await runGit(repoPath, ["merge", "--abort"]);
}

async function checkoutBranch(
  repoPath: string,
  branch: string
): Promise<void> {
  const result = await runGit(repoPath, ["checkout", branch]);
  if (result.exitCode !== 0) {
    throw new SyncBranchError(
      `Failed to checkout branch ${branch}: ${result.stderr}`,
      "CHECKOUT_FAILED"
    );
  }
}

/**
 * Sync a task's feature branch with the latest changes from the main branch.
 * This merges the main branch into the task branch (inverse of deploy).
 */
export async function syncBranch(
  repoPath: string,
  taskBranch: string,
  mainBranch: string
): Promise<SyncBranchResult | SyncBranchConflict> {
  // Expand tilde and validate repo path exists
  const expandedPath = expandPath(repoPath);
  if (!existsSync(expandedPath)) {
    throw new SyncBranchError(
      `Repository path does not exist: ${repoPath}`,
      "REPO_PATH_NOT_FOUND"
    );
  }
  repoPath = expandedPath;

  // Save current branch to return to later
  const previousBranch = await getCurrentBranch(repoPath);

  try {
    // 1. Fetch from origin
    const fetchResult = await runGit(repoPath, ["fetch", "origin"]);
    if (fetchResult.exitCode !== 0) {
      throw new SyncBranchError(
        `Failed to fetch: ${fetchResult.stderr}`,
        "FETCH_FAILED"
      );
    }

    // 2. Checkout task branch
    await checkoutBranch(repoPath, taskBranch);

    // 3. Pull latest changes for task branch (in case remote has updates)
    const pullResult = await runGit(repoPath, ["pull", "origin", taskBranch, "--ff-only"]);
    // It's OK if pull fails (e.g., no tracking branch), we'll continue

    // 4. Merge main branch into task branch
    const mergeResult = await runGit(repoPath, [
      "merge",
      "--no-ff",
      "--no-edit",
      `origin/${mainBranch}`,
    ]);

    if (mergeResult.exitCode !== 0) {
      // Check if it's a merge conflict
      const conflictedFiles = await getConflictedFiles(repoPath);
      if (conflictedFiles.length > 0) {
        await abortMerge(repoPath);
        return { status: "conflict", conflictedFiles };
      }
      throw new SyncBranchError(
        `Merge failed: ${mergeResult.stderr}`,
        "MERGE_FAILED"
      );
    }

    // 5. Push the updated task branch to origin
    const pushResult = await runGit(repoPath, ["push", "origin", taskBranch]);
    if (pushResult.exitCode !== 0) {
      throw new SyncBranchError(
        `Failed to push: ${pushResult.stderr}`,
        "PUSH_FAILED"
      );
    }

    // Get the commit SHA
    const shaResult = await runGit(repoPath, ["rev-parse", "HEAD"]);
    const commitSha = shaResult.stdout;

    return {
      status: "success",
      taskBranch,
      mainBranch,
      commitSha,
    };
  } finally {
    // 6. Return to previous branch
    try {
      await checkoutBranch(repoPath, previousBranch);
    } catch {
      // Ignore errors when returning to previous branch
    }
  }
}
