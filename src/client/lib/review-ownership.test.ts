import { describe, expect, test } from "bun:test";
import type { ChangesByCategory, ReviewRequest } from "../../shared/types";
import type { ReviewStatus } from "../../shared/review-status";
import {
  isIgnoredRequest,
  isMostlyBackend,
  isReviewSatisfied,
  memberTag,
  parseUsernames,
  prKey,
  requestTag,
} from "./review-ownership";

function request(author: string, assignees: string[] = []): ReviewRequest {
  return {
    prNumber: 1,
    title: "PR",
    url: "https://github.com/o/r/pull/1",
    repo: { owner: "o", repo: "r" },
    author,
    assignees,
    state: "open",
    isDraft: false,
    reviewStatus: null,
    myMissingCodeOwners: [],
    hasPendingReview: false,
    createdAt: "2026-10-16T00:00:00Z",
    changedFiles: null,
    additions: null,
    deletions: null,
    changesByCategory: null,
    taskId: null,
    taskJiraKey: null,
  };
}

describe("parseUsernames", () => {
  test("lowercases the logins of a JSON array", () => {
    expect(parseUsernames('["Alice","bob"]')).toEqual(new Set(["alice", "bob"]));
  });

  test("drops non-string entries", () => {
    expect(parseUsernames('["alice", 3, null]')).toEqual(new Set(["alice"]));
  });

  test("reads missing, malformed or non-array values as empty", () => {
    expect(parseUsernames(null)).toEqual(new Set());
    expect(parseUsernames(undefined)).toEqual(new Set());
    expect(parseUsernames("not json")).toEqual(new Set());
    expect(parseUsernames('{"a":1}')).toEqual(new Set());
  });
});

function reviewStatus(status: Partial<ReviewStatus>): ReviewStatus {
  return {
    decision: "REVIEW_REQUIRED",
    approvedCount: 0,
    requiredApprovals: 1,
    missingCodeOwners: [],
    optionalCodeOwners: [],
    changesRequestedBy: [],
    baseBranch: "master",
    ...status,
  };
}

describe("isReviewSatisfied", () => {
  const withStatus = (status: ReviewStatus | null, myMissingCodeOwners: string[] = []) => ({
    ...request("alice"),
    reviewStatus: status,
    myMissingCodeOwners,
  });

  test("is satisfied once GitHub says the reviews are done", () => {
    expect(isReviewSatisfied(withStatus(reviewStatus({ decision: "APPROVED", approvedCount: 1 })))).toBe(true);
    expect(isReviewSatisfied(withStatus(reviewStatus({ decision: null, requiredApprovals: 0 })))).toBe(true);
  });

  test("is satisfied when only others' code-owner reviews are missing", () => {
    expect(isReviewSatisfied(withStatus(reviewStatus({ approvedCount: 1, missingCodeOwners: ["backend"] })))).toBe(true);
  });

  test("still needs you when an approval or one of your code-owner reviews is missing", () => {
    expect(isReviewSatisfied(withStatus(reviewStatus({})))).toBe(false);
    expect(isReviewSatisfied(withStatus(reviewStatus({ approvedCount: 1, missingCodeOwners: ["front"] }), ["front"]))).toBe(false);
  });

  test("keeps a PR whose review status is unknown", () => {
    expect(isReviewSatisfied(withStatus(null))).toBe(false);
  });
});

describe("isMostlyBackend", () => {
  const changes = (backend: number, frontend: number): ChangesByCategory => ({
    frontend: { files: 1, additions: frontend, deletions: 0 },
    backend: { files: 1, additions: backend, deletions: 0 },
    other: { files: 0, additions: 0, deletions: 0 },
  });
  const withChanges = (changesByCategory: ChangesByCategory | null) => ({ ...request("alice"), changesByCategory });

  test("is true over 75% backend lines", () => {
    expect(isMostlyBackend(withChanges(changes(80, 20)))).toBe(true);
  });

  test("is false at or under 75%", () => {
    expect(isMostlyBackend(withChanges(changes(75, 25)))).toBe(false);
  });

  test("keeps PRs with unknown or empty changes", () => {
    expect(isMostlyBackend(withChanges(null))).toBe(false);
    expect(isMostlyBackend(withChanges(changes(0, 0)))).toBe(false);
  });
});

describe("prKey", () => {
  test("names the PR as owner/repo#number", () => {
    expect(prKey(request("alice"))).toBe("o/r#1");
  });
});

describe("isIgnoredRequest", () => {
  const ignored = new Set(["bot[bot]"]);

  test("ignores an ignored author's PR with no assignee", () => {
    expect(isIgnoredRequest(request("Bot[bot]"), ignored)).toBe(true);
  });

  test("keeps an ignored author's PR once someone is assigned", () => {
    expect(isIgnoredRequest(request("bot[bot]", ["alice"]), ignored)).toBe(false);
  });

  test("keeps PRs from other authors", () => {
    expect(isIgnoredRequest(request("alice"), ignored)).toBe(false);
  });
});

describe("memberTag", () => {
  const team = new Set(["alice", "carol"]);
  const vips = new Set(["bob", "carol"]);

  test("tags VIPs before teammates, case-insensitively", () => {
    expect(memberTag("Bob", team, vips)).toBe("vip");
    expect(memberTag("carol", team, vips)).toBe("vip");
    expect(memberTag("ALICE", team, vips)).toBe("team");
  });

  test("leaves anyone else untagged", () => {
    expect(memberTag("dave", team, vips)).toBeNull();
  });
});

describe("requestTag", () => {
  const team = new Set(["alice"]);
  const vips = new Set(["bob"]);

  test("highlights from the author", () => {
    expect(requestTag(request("alice"), team, vips)).toBe("team");
    expect(requestTag(request("bob"), team, vips)).toBe("vip");
  });

  test("highlights a bot's PR from its assignee", () => {
    expect(requestTag(request("bot[bot]", ["Alice"]), team, vips)).toBe("team");
    expect(requestTag(request("bot[bot]", ["dave", "bob"]), team, vips)).toBe("vip");
  });

  test("lets a VIP assignee outrank a teammate author", () => {
    expect(requestTag(request("alice", ["bob"]), team, vips)).toBe("vip");
  });

  test("leaves the row plain when nobody is tagged", () => {
    expect(requestTag(request("bot[bot]", ["dave"]), team, vips)).toBeNull();
  });
});
