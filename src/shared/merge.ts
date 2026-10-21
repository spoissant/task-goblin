// Merge gate and post-merge watch vocabulary, shared by the server (merge-gate.ts,
// merge-watch.ts, inbox.ts) and the client (Inbox page, task detail).

/** Why the gate did not enable auto-merge on a Ready to Merge PR. */
export type HoldReason =
  | "not-ready-to-merge"
  | "draft"
  | "changes-requested"
  | "awaiting-approval"
  | "checks-pending"
  | "checks-failing"
  | "conflicts"
  | "unresolved-comments"
  | "base-ci-red"
  | "base-ci-unknown"
  | "prerelease-pin";

/** Holds the user has to act on; the others clear on their own (reviewers, CI). */
export const ACTIONABLE_HOLDS: ReadonlySet<HoldReason> = new Set<HoldReason>([
  "checks-failing",
  "conflicts",
  "unresolved-comments",
  "changes-requested",
  "base-ci-red",
  "prerelease-pin",
]);

export const HOLD_LABELS: Record<HoldReason, string> = {
  "not-ready-to-merge": "Jira is not Ready to Merge",
  draft: "PR is a draft",
  "changes-requested": "a reviewer requested changes",
  "awaiting-approval": "waiting for approval",
  "checks-pending": "checks still running",
  "checks-failing": "checks failing",
  conflicts: "merge conflicts",
  "unresolved-comments": "unresolved review comments",
  "base-ci-red": "the base branch build is red",
  "base-ci-unknown": "the base branch build state is unknown",
  "prerelease-pin": "a prerelease package or SDK pin",
};

/** Stored as JSON in tasks.merge_hold. */
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

/** The base-branch build of a merged PR's merge commit. */
export type BaseBuildState = "pending" | "passed" | "failed" | "missing";
