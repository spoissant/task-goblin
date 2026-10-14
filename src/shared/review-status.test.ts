import { describe, it, expect } from "bun:test";
import { isReviewReady, parseReviewStatus, reviewGaps, type ReviewStatus } from "./review-status";

const status = (overrides: Partial<ReviewStatus>): ReviewStatus => ({
  decision: "REVIEW_REQUIRED",
  approvedCount: 0,
  requiredApprovals: 1,
  missingCodeOwners: [],
  optionalCodeOwners: [],
  changesRequestedBy: [],
  baseBranch: "sprint",
  ...overrides,
});

describe("isReviewReady", () => {
  it("is ready when GitHub approves or requires no review", () => {
    expect(isReviewReady(status({ decision: "APPROVED" }))).toBe(true);
    expect(isReviewReady(status({ decision: null }))).toBe(true);
  });

  it("is not ready while reviews are owed, or when unknown", () => {
    expect(isReviewReady(status({ decision: "REVIEW_REQUIRED" }))).toBe(false);
    expect(isReviewReady(status({ decision: "CHANGES_REQUESTED" }))).toBe(false);
    expect(isReviewReady(null)).toBe(false);
  });
});

describe("reviewGaps", () => {
  it("has nothing missing once ready", () => {
    expect(reviewGaps(status({ decision: "APPROVED", missingCodeOwners: ["squad-fe"] }))).toEqual([]);
  });

  it("lists changes requests, missing approvals, then code owners", () => {
    const gaps = reviewGaps(
      status({
        decision: "CHANGES_REQUESTED",
        approvedCount: 0,
        requiredApprovals: 2,
        missingCodeOwners: ["squad-fe"],
        changesRequestedBy: ["bdarcet"],
      })
    );

    expect(gaps).toEqual([
      { kind: "changes", who: "bdarcet" },
      { kind: "approvals", count: 2 },
      { kind: "codeOwner", name: "squad-fe" },
    ]);
  });

  it("names only the code owner when the approval count is met", () => {
    expect(reviewGaps(status({ approvedCount: 1, missingCodeOwners: ["squad-fe"] }))).toEqual([
      { kind: "codeOwner", name: "squad-fe" },
    ]);
  });

  it("falls back to a bare review gap when GitHub blocks without a nameable cause", () => {
    expect(reviewGaps(status({ approvedCount: 1 }))).toEqual([{ kind: "review" }]);
  });
});

describe("parseReviewStatus", () => {
  it("reads stored JSON", () => {
    const stored = status({ decision: "APPROVED", approvedCount: 2 });
    expect(parseReviewStatus(JSON.stringify(stored))).toEqual(stored);
  });

  it("fills fields that rows synced before them lack", () => {
    const legacy = { decision: "APPROVED", approvedCount: 1, requiredApprovals: 1, missingCodeOwners: [], changesRequestedBy: [] };
    expect(parseReviewStatus(JSON.stringify(legacy))).toEqual({ ...legacy, optionalCodeOwners: [], baseBranch: null } as ReviewStatus);
  });

  it("treats absent or malformed values as unknown", () => {
    expect(parseReviewStatus(null)).toBeNull();
    expect(parseReviewStatus("not json")).toBeNull();
    expect(parseReviewStatus("42")).toBeNull();
    expect(parseReviewStatus("null")).toBeNull();
  });
});
