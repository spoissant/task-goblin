import { expandPath } from "./path";

export async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: expandPath(cwd),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
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
