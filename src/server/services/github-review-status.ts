import type { ReviewDecision, ReviewStatus } from "@/shared/review-status";

// `reviewDecision` is GitHub's own verdict on the review requirements and
// honours repository rulesets; the other fields only explain it. The required
// approval count and the code-owner rule come from the base ref's rulesets,
// with `branchProtectionRule` covering repos still on classic protection (it
// reads as null under rulesets).
//
// GitHub opens a review request per code owner (`asCodeOwner`) and drops it
// once a member reviews, so the open ones are the owners still missing — or,
// when the base ref doesn't gate on them, a courtesy.
export const REVIEW_STATUS_FIELDS = `
  reviewDecision
  reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { __typename ... on Team { slug } ... on User { login } } } }
  latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { state author { login } } }
  baseRef {
    name
    branchProtectionRule { requiredApprovingReviewCount requiresCodeOwnerReviews }
    rules(first: 20) { nodes { type parameters { ... on PullRequestParameters { requiredApprovingReviewCount requireCodeOwnerReview } } } }
  }`;

interface Nodes<T> {
  nodes?: Array<T | null> | null;
}

/** The slice of a PullRequest node that REVIEW_STATUS_FIELDS selects. */
export interface GqlReviewStatusNode {
  reviewDecision?: string | null;
  reviewRequests?: Nodes<{
    asCodeOwner?: boolean | null;
    requestedReviewer?: { __typename?: string; slug?: string; login?: string } | null;
  }> | null;
  latestOpinionatedReviews?: Nodes<{ state?: string | null; author?: { login?: string } | null }> | null;
  baseRef?: {
    name?: string | null;
    branchProtectionRule?: {
      requiredApprovingReviewCount?: number | null;
      requiresCodeOwnerReviews?: boolean | null;
    } | null;
    rules?: Nodes<{
      type?: string | null;
      parameters?: { requiredApprovingReviewCount?: number | null; requireCodeOwnerReview?: boolean | null } | null;
    }> | null;
  } | null;
}

const DECISIONS = new Set<string>(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]);

function present<T>(connection: Nodes<T> | null | undefined): T[] {
  return (connection?.nodes ?? []).filter((n): n is T => n != null);
}

export function toReviewStatus(pr: GqlReviewStatusNode): ReviewStatus {
  const decision = DECISIONS.has(pr.reviewDecision ?? "") ? (pr.reviewDecision as ReviewDecision) : null;

  // Several rulesets can target one branch: the strictest one applies.
  const protection = pr.baseRef?.branchProtectionRule;
  const pullRequestRules = present(pr.baseRef?.rules)
    .filter((r) => r.type === "PULL_REQUEST")
    .map((r) => r.parameters ?? {});
  const requiredApprovals = Math.max(
    protection?.requiredApprovingReviewCount ?? 0,
    ...pullRequestRules.map((p) => p.requiredApprovingReviewCount ?? 0)
  );
  const codeOwnersRequired =
    !!protection?.requiresCodeOwnerReviews || pullRequestRules.some((p) => !!p.requireCodeOwnerReview);

  // Open code-owner requests are a courtesy unless the ref requires them and
  // GitHub still says reviews are owed.
  const owesReviews = decision === "REVIEW_REQUIRED" || decision === "CHANGES_REQUESTED";
  const codeOwnerRequests = present(pr.reviewRequests)
    .filter((r) => r.asCodeOwner)
    .map((r) => r.requestedReviewer?.slug ?? r.requestedReviewer?.login)
    .filter((name): name is string => !!name);
  const gating = codeOwnersRequired && owesReviews;

  const reviews = present(pr.latestOpinionatedReviews);
  const loginsIn = (state: string) =>
    reviews
      .filter((r) => r.state === state)
      .map((r) => r.author?.login)
      .filter((login): login is string => !!login);

  return {
    decision,
    approvedCount: loginsIn("APPROVED").length,
    requiredApprovals,
    missingCodeOwners: gating ? codeOwnerRequests : [],
    optionalCodeOwners: gating ? [] : codeOwnerRequests,
    changesRequestedBy: loginsIn("CHANGES_REQUESTED"),
    baseBranch: pr.baseRef?.name ?? null,
  };
}
