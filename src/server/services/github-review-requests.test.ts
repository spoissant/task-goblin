import { describe, expect, it } from "bun:test";
import { searchQueries, toReviewRequest, type ReviewContext } from "./github-review-requests";
import type { GqlPrReviewInfo } from "./github-graphql";
import type { ReviewStatus } from "@/shared/review-status";

type SearchHit = Parameters<typeof toReviewRequest>[0];

const hit = (over: Record<string, unknown> = {}) =>
  ({
    title: "fix polls",
    html_url: "https://github.com/hb/alumni_connect/pull/9",
    user: { login: "bob" },
    assignees: [{ login: "carol" }],
    draft: false,
    created_at: "2026-10-22T00:00:00Z",
    ...over,
  }) as unknown as SearchHit;

const target = { owner: "hb", repo: "alumni_connect", number: 9 };

const reviewStatus: ReviewStatus = {
  decision: "REVIEW_REQUIRED",
  approvedCount: 0,
  requiredApprovals: 1,
  missingCodeOwners: ["squad-fe", "other-team", "me"],
  optionalCodeOwners: [],
  changesRequestedBy: [],
  baseBranch: "sprint",
};

const info = (reviews: GqlPrReviewInfo["reviews"]): GqlPrReviewInfo => ({
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  reviews,
  files: [{ filename: "app/models/poll.rb", additions: 10, deletions: 2 }],
  reviewStatus,
});

const ctx = (over: Partial<ReviewContext> = {}): ReviewContext => ({
  scope: "others",
  username: "me",
  codeownerTeamsByOrg: new Map([["hb", new Set(["squad-fe"])]]),
  taskByPr: new Map([["hb/alumni_connect#9", { id: 4, jiraKey: "EV-1" }]]),
  ...over,
});

describe("searchQueries", () => {
  it("searches your own open PRs, or those requesting you or one of your teams, not yours", () => {
    expect(searchQueries("mine", "me", [])).toEqual(["is:pr is:open author:me"]);
    expect(searchQueries("others", "me", [{ org: "hb", slug: "squad-fe", name: "Squad FE" }])).toEqual([
      "is:pr is:open review-requested:me",
      "is:pr is:open team-review-requested:hb/squad-fe -author:me",
    ]);
  });
});

describe("toReviewRequest", () => {
  it("builds the row from the hit and its review info, flagging your missing code owners and your draft review", () => {
    const row = toReviewRequest(hit(), target, info([{ authorLogin: "me", state: "PENDING" }]), ctx());

    expect(row).toMatchObject({
      prNumber: 9,
      author: "bob",
      assignees: ["carol"],
      state: "open",
      reviewStatus,
      myMissingCodeOwners: ["squad-fe", "me"],
      hasPendingReview: true,
      changedFiles: 1,
      changesByCategory: { backend: { files: 1, additions: 10, deletions: 2 } },
      taskId: 4,
      taskJiraKey: "EV-1",
    });
  });

  it("leaves others' PRs you last approved out, and keeps them while the reviews are unknown", () => {
    expect(toReviewRequest(hit(), target, info([{ authorLogin: "me", state: "APPROVED" }]), ctx())).toBeNull();
    expect(toReviewRequest(hit(), target, info([{ authorLogin: "me", state: "APPROVED" }]), ctx({ scope: "mine" }))).not.toBeNull();
    expect(
      toReviewRequest(hit(), target, info([{ authorLogin: "me", state: "APPROVED" }, { authorLogin: "me", state: "COMMENTED" }]), ctx())
    ).not.toBeNull();

    const unknown = toReviewRequest(hit({ draft: true }), target, null, ctx({ taskByPr: new Map() }));
    expect(unknown).toMatchObject({ state: "draft", reviewStatus: null, changedFiles: null, changesByCategory: null, taskId: null });
  });
});
