import { existsSync } from "fs";
import { homedir } from "os";

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return path.replace("~", homedir());
  }
  return path;
}

export interface DeployResult {
  status: "success";
  targetBranch: string;
  sourceBranch: string;
  commitSha: string;
}

export interface DeployConflict {
  status: "conflict";
  conflictedFiles: string[];
}

export interface BulkDeployTaskResult {
  taskId: number;
  status: "success" | "conflict" | "skipped";
  commitSha?: string;
  conflictedFiles?: string[];
  reason?: string;
}

export interface BulkDeployResult {
  results: BulkDeployTaskResult[];
  summary: {
    success: number;
    conflict: number;
    skipped: number;
  };
}

export class DeployError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DeployError";
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
    throw new DeployError("Failed to get current branch", "GIT_ERROR");
  }
  return result.stdout;
}

async function getGitUserName(repoPath: string): Promise<string> {
  const result = await runGit(repoPath, ["config", "user.name"]);
  return result.exitCode === 0 ? result.stdout : "unknown";
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
    throw new DeployError(
      `Failed to checkout branch ${branch}: ${result.stderr}`,
      "CHECKOUT_FAILED"
    );
  }
}

export async function deployBranch(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string
): Promise<DeployResult | DeployConflict> {
  // Expand tilde and validate repo path exists
  const expandedPath = expandPath(repoPath);
  if (!existsSync(expandedPath)) {
    throw new DeployError(
      `Repository path does not exist: ${repoPath}`,
      "REPO_PATH_NOT_FOUND"
    );
  }
  repoPath = expandedPath;

  // Save current branch to return to later
  const previousBranch = await getCurrentBranch(repoPath);
  const userName = await getGitUserName(repoPath);

  try {
    // 1. Fetch from origin
    const fetchResult = await runGit(repoPath, ["fetch", "origin"]);
    if (fetchResult.exitCode !== 0) {
      throw new DeployError(
        `Failed to fetch: ${fetchResult.stderr}`,
        "FETCH_FAILED"
      );
    }

    // 2. Checkout target branch
    await checkoutBranch(repoPath, targetBranch);

    // 3. Reset to origin/<targetBranch>
    const resetResult = await runGit(repoPath, [
      "reset",
      "--hard",
      `origin/${targetBranch}`,
    ]);
    if (resetResult.exitCode !== 0) {
      throw new DeployError(
        `Failed to reset to origin/${targetBranch}: ${resetResult.stderr}`,
        "RESET_FAILED"
      );
    }

    // 4. Merge source branch
    const mergeResult = await runGit(repoPath, [
      "merge",
      "--no-ff",
      "--no-edit",
      `origin/${sourceBranch}`,
    ]);

    if (mergeResult.exitCode !== 0) {
      // Check if it's a merge conflict
      const conflictedFiles = await getConflictedFiles(repoPath);
      if (conflictedFiles.length > 0) {
        await abortMerge(repoPath);
        return { status: "conflict", conflictedFiles };
      }
      throw new DeployError(
        `Merge failed: ${mergeResult.stderr}`,
        "MERGE_FAILED"
      );
    }

    // 5. Create deploy commit
    const commitResult = await runGit(repoPath, [
      "commit",
      "--allow-empty",
      "-m",
      `chore: [${userName}] [papi-deploy]`,
    ]);
    if (commitResult.exitCode !== 0 && !commitResult.stderr.includes("nothing to commit")) {
      throw new DeployError(
        `Failed to create commit: ${commitResult.stderr}`,
        "COMMIT_FAILED"
      );
    }

    // 6. Push to origin
    const pushResult = await runGit(repoPath, ["push", "origin", targetBranch]);
    if (pushResult.exitCode !== 0) {
      throw new DeployError(
        `Failed to push: ${pushResult.stderr}`,
        "PUSH_FAILED"
      );
    }

    // Get the commit SHA
    const shaResult = await runGit(repoPath, ["rev-parse", "HEAD"]);
    const commitSha = shaResult.stdout;

    return {
      status: "success",
      targetBranch,
      sourceBranch,
      commitSha,
    };
  } finally {
    // 7. Return to previous branch
    try {
      await checkoutBranch(repoPath, previousBranch);
    } catch {
      // Ignore errors when returning to previous branch
    }
  }
}

export interface TaskBranchInfo {
  taskId: number;
  headBranch: string | null;
}

export async function deployBulk(
  repoPath: string,
  tasks: TaskBranchInfo[],
  targetBranch: string
): Promise<BulkDeployResult> {
  // Expand tilde and validate repo path exists
  const expandedPath = expandPath(repoPath);
  if (!existsSync(expandedPath)) {
    throw new DeployError(
      `Repository path does not exist: ${repoPath}`,
      "REPO_PATH_NOT_FOUND"
    );
  }
  repoPath = expandedPath;

  const results: BulkDeployTaskResult[] = [];
  let success = 0;
  let conflict = 0;
  let skipped = 0;

  // Filter tasks without branches (mark as skipped)
  const tasksWithBranches: Array<{ taskId: number; headBranch: string }> = [];
  for (const task of tasks) {
    if (!task.headBranch) {
      results.push({
        taskId: task.taskId,
        status: "skipped",
        reason: "no branch",
      });
      skipped++;
    } else {
      tasksWithBranches.push({ taskId: task.taskId, headBranch: task.headBranch });
    }
  }

  if (tasksWithBranches.length === 0) {
    return { results, summary: { success, conflict, skipped } };
  }

  // Save current branch to return to later
  const previousBranch = await getCurrentBranch(repoPath);
  const userName = await getGitUserName(repoPath);

  let hasConflict = false;
  const mergedTaskIds: number[] = [];

  try {
    // 1. Fetch from origin
    const fetchResult = await runGit(repoPath, ["fetch", "origin"]);
    if (fetchResult.exitCode !== 0) {
      throw new DeployError(
        `Failed to fetch: ${fetchResult.stderr}`,
        "FETCH_FAILED"
      );
    }

    // 2. Checkout target branch
    await checkoutBranch(repoPath, targetBranch);

    // 3. Reset to origin/<targetBranch>
    const resetResult = await runGit(repoPath, [
      "reset",
      "--hard",
      `origin/${targetBranch}`,
    ]);
    if (resetResult.exitCode !== 0) {
      throw new DeployError(
        `Failed to reset to origin/${targetBranch}: ${resetResult.stderr}`,
        "RESET_FAILED"
      );
    }

    // 4. Merge each task's branch sequentially
    for (const task of tasksWithBranches) {
      if (hasConflict) {
        // Skip remaining tasks after a conflict
        results.push({
          taskId: task.taskId,
          status: "skipped",
          reason: "stopped due to earlier conflict",
        });
        skipped++;
        continue;
      }

      const mergeResult = await runGit(repoPath, [
        "merge",
        "--no-ff",
        "--no-edit",
        `origin/${task.headBranch}`,
      ]);

      if (mergeResult.exitCode !== 0) {
        const conflictedFiles = await getConflictedFiles(repoPath);
        if (conflictedFiles.length > 0) {
          await abortMerge(repoPath);
          results.push({
            taskId: task.taskId,
            status: "conflict",
            conflictedFiles,
          });
          conflict++;
          hasConflict = true;
          continue;
        }
        throw new DeployError(
          `Merge failed for task ${task.taskId}: ${mergeResult.stderr}`,
          "MERGE_FAILED"
        );
      }

      mergedTaskIds.push(task.taskId);
    }

    // If we have successful merges and no conflict, push
    if (mergedTaskIds.length > 0) {
      // 5. Create deploy commit
      const commitResult = await runGit(repoPath, [
        "commit",
        "--allow-empty",
        "-m",
        `chore: [${userName}] [papi-deploy]`,
      ]);
      if (commitResult.exitCode !== 0 && !commitResult.stderr.includes("nothing to commit")) {
        throw new DeployError(
          `Failed to create commit: ${commitResult.stderr}`,
          "COMMIT_FAILED"
        );
      }

      // 6. Push to origin
      const pushResult = await runGit(repoPath, ["push", "origin", targetBranch]);
      if (pushResult.exitCode !== 0) {
        throw new DeployError(
          `Failed to push: ${pushResult.stderr}`,
          "PUSH_FAILED"
        );
      }

      // Get the commit SHA
      const shaResult = await runGit(repoPath, ["rev-parse", "HEAD"]);
      const commitSha = shaResult.stdout;

      // 7. Mark all merged tasks as success
      for (const taskId of mergedTaskIds) {
        results.push({
          taskId,
          status: "success",
          commitSha,
        });
        success++;
      }
    }

    return { results, summary: { success, conflict, skipped } };
  } finally {
    // 8. Return to previous branch
    try {
      await checkoutBranch(repoPath, previousBranch);
    } catch {
      // Ignore errors when returning to previous branch
    }
  }
}
