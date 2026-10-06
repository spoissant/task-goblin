import { describe, it, expect } from "bun:test";
import { computeCodeownerReview, selectCodeownerTeams } from "./github-teams";
import type { GitHubTeam } from "@/shared/types";

const TEAMS: GitHubTeam[] = [
  { org: "Hivebrite", slug: "squad-fe", name: "squad-fe" },
  { org: "Hivebrite", slug: "everyone", name: "everyone" },
  { org: "OtherOrg", slug: "squad-fe", name: "squad-fe" },
];

describe("selectCodeownerTeams", () => {
  it("counts every team when nothing is stored", () => {
    const byOrg = selectCodeownerTeams(TEAMS, null);
    expect(byOrg.get("Hivebrite")).toEqual(new Set(["squad-fe", "everyone"]));
    expect(byOrg.get("OtherOrg")).toEqual(new Set(["squad-fe"]));
  });

  it("narrows to the stored slugs", () => {
    const byOrg = selectCodeownerTeams(TEAMS, JSON.stringify(["squad-fe"]));
    expect(byOrg.get("Hivebrite")).toEqual(new Set(["squad-fe"]));
  });

  it("treats an empty stored list as an opt-out", () => {
    expect(selectCodeownerTeams(TEAMS, "[]").size).toBe(0);
  });

  it("falls back to every team on malformed values", () => {
    expect(selectCodeownerTeams(TEAMS, "not json").size).toBe(2);
    expect(selectCodeownerTeams(TEAMS, JSON.stringify({ slug: "x" })).size).toBe(2);
  });
});

describe("computeCodeownerReview", () => {
  const mine = new Set(["squad-fe"]);
  const owns = [{ slug: "squad-fe", asCodeOwner: true }];

  it("is empty when no team of mine is involved", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: [{ slug: "squad-be", asCodeOwner: true }],
      reviewedTeams: ["squad-other"],
    });
    expect(result).toEqual([]);
  });

  it("blocks when my team owns files on a PR that still needs a review", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "blocking" }]);
  });

  it("blocks when changes were requested and my team still owes a review", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "CHANGES_REQUESTED",
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "blocking" }]);
  });

  it("is optional when the base ref requires no review at all", () => {
    // PR 36548: a real CODEOWNERS request, but nothing gates merging on it.
    const result = computeCodeownerReview(mine, {
      reviewDecision: null,
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "optional" }]);
  });

  it("is optional once the PR's review requirements are already met", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "APPROVED",
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "optional" }]);
  });

  it("is optional when my team was hand-picked rather than owning the files", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: [{ slug: "squad-fe", asCodeOwner: false }],
      reviewedTeams: [],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "optional" }]);
  });

  it("is reviewed once my team has reviewed", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: [],
      reviewedTeams: ["squad-fe"],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "reviewed" }]);
  });

  it("reports each of my teams separately when only some have reviewed", () => {
    // PR 38054: front-admins approved, squad-connect-and-learn-frontend still pending.
    const result = computeCodeownerReview(new Set(["squad-fe", "squad"]), {
      reviewDecision: null,
      pendingTeams: [{ slug: "squad-fe", asCodeOwner: false }],
      reviewedTeams: ["squad"],
    });
    expect(result).toEqual([
      { slug: "squad-fe", state: "optional" },
      { slug: "squad", state: "reviewed" },
    ]);
  });

  it("treats a re-requested team as pending even if it reviewed before", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: owns,
      reviewedTeams: ["squad-fe"],
    });
    expect(result).toEqual([{ slug: "squad-fe", state: "blocking" }]);
  });

  it("is empty without teams or PR data", () => {
    expect(
      computeCodeownerReview(undefined, {
        reviewDecision: "REVIEW_REQUIRED",
        pendingTeams: owns,
        reviewedTeams: [],
      })
    ).toEqual([]);
    expect(computeCodeownerReview(mine, undefined)).toEqual([]);
  });
});
