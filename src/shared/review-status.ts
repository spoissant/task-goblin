// The review side of a PR's merge gate: whether its reviews would let it merge
// once checks pass. Checks and unresolved threads have their own columns and
// are deliberately left out.

/** GitHub's verdict on a PR's review requirements. */
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

export interface ReviewStatus {
  /**
   * GitHub's own verdict, which honours rulesets and code-owner rules; null
   * when the base ref requires no review at all.
   */
  decision: ReviewDecision | null;
  /** Approvals from reviewers with write access, latest review per user. */
  approvedCount: number;
  /** Approvals the base ref requires, 0 when it requires none. */
  requiredApprovals: number;
  /**
   * Code owners (team slugs or user logins) still asked to review, only when
   * the base ref requires code-owner review and GitHub still owes one.
   */
  missingCodeOwners: string[];
  /**
   * Code owners still asked to review whose review doesn't gate this merge:
   * the base ref doesn't require code owners (a PR stacked on a feature
   * branch), or GitHub's requirements are already met.
   */
  optionalCodeOwners: string[];
  /** Reviewers whose latest review requests changes. */
  changesRequestedBy: string[];
  /** The base branch whose rules set these requirements. */
  baseBranch: string | null;
}

/** One thing standing between a PR and a mergeable review state. */
export type ReviewGap =
  | { kind: "changes"; who: string }
  | { kind: "approvals"; count: number }
  | { kind: "codeOwner"; name: string }
  /** GitHub wants a review but none of the above explains it. */
  | { kind: "review" };

/** Unknown (null) is never ready, so a PR nobody has synced still reads as owing reviews. */
export function isReviewReady(status: ReviewStatus | null): boolean {
  return status != null && status.decision !== "REVIEW_REQUIRED" && status.decision !== "CHANGES_REQUESTED";
}

/**
 * What's still missing, most actionable first. A code-owner team that only
 * commented drops out of GitHub's pending requests while still owing an
 * approval, so a blocked PR can have nothing nameable: that reads as a bare
 * "review" gap rather than as ready.
 */
export function reviewGaps(status: ReviewStatus): ReviewGap[] {
  if (isReviewReady(status)) return [];
  const gaps: ReviewGap[] = status.changesRequestedBy.map((who) => ({ kind: "changes", who }));
  if (status.approvedCount < status.requiredApprovals) {
    gaps.push({ kind: "approvals", count: status.requiredApprovals - status.approvedCount });
  }
  for (const name of status.missingCodeOwners) gaps.push({ kind: "codeOwner", name });
  return gaps.length ? gaps : [{ kind: "review" }];
}

/** Read the JSON stored on a task. Absent or malformed means unknown. */
export function parseReviewStatus(json: string | null): ReviewStatus | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    // Rows synced before these fields existed (completed tasks stop syncing) lack them.
    const status = parsed as ReviewStatus;
    return { ...status, optionalCodeOwners: status.optionalCodeOwners ?? [], baseBranch: status.baseBranch ?? null };
  } catch {
    return null;
  }
}
