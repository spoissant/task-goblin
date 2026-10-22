// Merge gate and post-merge watch vocabulary (merge-gate.ts, merge-watch.ts).

/** Why the gate holds a Ready to Merge PR (no Merge button). */
export type HoldReason =
  | "not-ready-to-merge"
  | "draft"
  | "changes-requested"
  | "awaiting-approval"
  | "checks-pending"
  | "checks-failing"
  | "conflicts"
  | "unresolved-comments"
  | "alumni-connect-branch" // hivetests PR whose branch an alumni_connect task has: it merges with that PR
  | "prerelease-pin";

/** Stored as JSON in tasks.merge_hold; no reasons means the PR passes every gate. */
export interface MergeHold {
  reasons: HoldReason[];
  at: string;
}

export function parseMergeHold(value: string | null | undefined): MergeHold | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MergeHold;
    return Array.isArray(parsed.reasons) ? parsed : null;
  } catch {
    return null;
  }
}

/** The gate cleared the PR: show its Merge button. */
export function isMergeReady(task: { mergeHold: string | null }): boolean {
  return parseMergeHold(task.mergeHold)?.reasons.length === 0;
}

/** The base-branch build of a merged PR's merge commit. */
export type BaseBuildState = "pending" | "passed" | "failed" | "missing";
