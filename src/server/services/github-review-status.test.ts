import { describe, it, expect } from "bun:test";
import { toReviewStatus, type GqlReviewStatusNode } from "./github-review-status";

const rulesetRef = (requiredApprovingReviewCount: number, requireCodeOwnerReview: boolean) => ({
  branchProtectionRule: null,
  rules: {
    nodes: [
      { type: "REQUIRED_STATUS_CHECKS", parameters: {} },
      { type: "PULL_REQUEST", parameters: { requiredApprovingReviewCount, requireCodeOwnerReview } },
    ],
  },
});

const codeOwnerRequest = (slug: string) => ({
  asCodeOwner: true,
  requestedReviewer: { __typename: "Team", slug },
});

describe("toReviewStatus", () => {
  it("names the code-owner team still owed when the ruleset requires code owners", () => {
    const status = toReviewStatus({
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequests: {
        nodes: [
          codeOwnerRequest("squad-connect-and-learn-frontend"),
          { asCodeOwner: false, requestedReviewer: { __typename: "User", login: "loeck" } },
        ],
      },
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: "cbegne" } }] },
      baseRef: rulesetRef(1, true),
    });

    expect(status).toEqual({
      decision: "REVIEW_REQUIRED",
      approvedCount: 1,
      requiredApprovals: 1,
      missingCodeOwners: ["squad-connect-and-learn-frontend"],
      changesRequestedBy: [],
    });
  });

  it("keeps code-owner requests out when the ruleset doesn't require code owners", () => {
    const status = toReviewStatus({
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequests: { nodes: [codeOwnerRequest("front-admins")] },
      latestOpinionatedReviews: { nodes: [] },
      baseRef: rulesetRef(1, false),
    });

    expect(status.missingCodeOwners).toEqual([]);
    expect(status.requiredApprovals).toBe(1);
    expect(status.approvedCount).toBe(0);
  });

  it("treats code-owner requests as a courtesy once GitHub approves", () => {
    const status = toReviewStatus({
      reviewDecision: "APPROVED",
      reviewRequests: { nodes: [codeOwnerRequest("squad-fe")] },
      baseRef: rulesetRef(1, true),
    });

    expect(status.missingCodeOwners).toEqual([]);
  });

  it("lists code owners still owed alongside a changes request", () => {
    const status = toReviewStatus({
      reviewDecision: "CHANGES_REQUESTED",
      reviewRequests: {
        nodes: [{ asCodeOwner: true, requestedReviewer: { __typename: "User", login: "owner-user" } }, null],
      },
      latestOpinionatedReviews: {
        nodes: [
          { state: "CHANGES_REQUESTED", author: { login: "bdarcet" } },
          { state: "APPROVED", author: { login: "americos" } },
          { state: "DISMISSED", author: { login: "someone" } },
          { state: "APPROVED", author: null },
        ],
      },
      baseRef: rulesetRef(1, true),
    });

    expect(status.decision).toBe("CHANGES_REQUESTED");
    expect(status.changesRequestedBy).toEqual(["bdarcet"]);
    expect(status.approvedCount).toBe(1);
    expect(status.missingCodeOwners).toEqual(["owner-user"]);
  });

  it("applies the strictest rule across rulesets and classic protection", () => {
    const status = toReviewStatus({
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequests: { nodes: [codeOwnerRequest("squad-fe")] },
      baseRef: {
        branchProtectionRule: { requiredApprovingReviewCount: 2, requiresCodeOwnerReviews: false },
        rules: { nodes: [{ type: "PULL_REQUEST", parameters: { requiredApprovingReviewCount: 1, requireCodeOwnerReview: true } }] },
      },
    });

    expect(status.requiredApprovals).toBe(2);
    expect(status.missingCodeOwners).toEqual(["squad-fe"]);
  });

  it("honours classic branch protection alone", () => {
    const status = toReviewStatus({
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequests: { nodes: [codeOwnerRequest("squad-fe")] },
      baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 1, requiresCodeOwnerReviews: true }, rules: null },
    });

    expect(status.requiredApprovals).toBe(1);
    expect(status.missingCodeOwners).toEqual(["squad-fe"]);
  });

  it("reads a ref without review rules, or an unknown decision, as requiring nothing", () => {
    const bare: GqlReviewStatusNode = { reviewDecision: null, baseRef: null };
    expect(toReviewStatus(bare)).toEqual({
      decision: null,
      approvedCount: 0,
      requiredApprovals: 0,
      missingCodeOwners: [],
      changesRequestedBy: [],
    });
    expect(toReviewStatus({ reviewDecision: "SOMETHING_NEW" }).decision).toBeNull();
    expect(toReviewStatus({ baseRef: { rules: { nodes: [{ type: "PULL_REQUEST", parameters: null }] } } }).requiredApprovals).toBe(0);
  });
});
