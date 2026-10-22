/**
 * Puts the main checkout on a dev stack's code: the owner's task branch or
 * the PR's head, detached, with the merged tasks' branches merged on top.
 */
import { abortMerge, fetchRef, getConflictedFiles, localBranchExists, remoteBranchExists, runGit } from "../lib/git";
import { parsePrUrl } from "../lib/validation";
import type { StoredStack } from "./dev-stack-store";

/**
 * A PR's head as GitHub serves it, or a task branch, fetched first and then
 * preferring the local ref (worktree commits land there) over origin.
 */
async function resolveTarget(mainPath: string, stored: StoredStack): Promise<string | null> {
  if (stored.prUrl) {
    const fetched = await fetchRef(mainPath, `pull/${parsePrUrl(stored.prUrl).number}/head`);
    return fetched.exitCode === 0 ? "FETCH_HEAD" : null;
  }
  return resolveBranch(mainPath, stored.branch);
}

async function resolveBranch(mainPath: string, branch: string): Promise<string | null> {
  await fetchRef(mainPath, branch);
  if (await localBranchExists(mainPath, branch)) return branch;
  if (await remoteBranchExists(mainPath, branch)) return `origin/${branch}`;
  return null;
}

/**
 * Detach the main checkout at the owner's target, then merge each merged
 * task's branch on top. Hooks are off for the merges: these commits are
 * throwaway and commit hooks (lint, message checks) would only slow or block
 * them. Returns an error message, or null once checked out.
 */
export async function checkoutStack(mainPath: string, stored: StoredStack, discardChanges: boolean): Promise<string | null> {
  const target = await resolveTarget(mainPath, stored);
  if (!target) return `${stored.branch} not found locally or on origin`;

  const switched = await runGit(mainPath, ["switch", "--detach", ...(discardChanges ? ["--discard-changes"] : []), target]);
  if (switched.exitCode !== 0) return switched.stderr || `git switch --detach ${target} failed`;

  for (const m of stored.merged ?? []) {
    const ref = await resolveBranch(mainPath, m.branch);
    if (!ref) return `${m.branch} not found locally or on origin`;
    const merge = await runGit(mainPath, ["-c", "core.hooksPath=/dev/null", "merge", "--no-edit", ref]);
    if (merge.exitCode !== 0) {
      const files = await getConflictedFiles(mainPath);
      await abortMerge(mainPath);
      return `${m.branch} does not merge cleanly on top of ${stored.branch}: ${files.length > 0 ? files.join(", ") : merge.stderr}`;
    }
  }
  return null;
}

export async function shortHead(mainPath: string): Promise<string> {
  return (await runGit(mainPath, ["rev-parse", "--short", "HEAD"])).stdout.trim();
}
