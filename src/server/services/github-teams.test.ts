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

  it("is none when no team of mine is involved", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: [{ slug: "squad-be", asCodeOwner: true }],
      reviewedTeams: ["squad-other"],
    });
    expect(result.state).toBe("none");
  });

  it("blocks when my team owns files on a PR that still needs a review", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result).toEqual({ state: "blocking", pendingTeams: ["squad-fe"], reviewedTeams: [] });
  });

  it("blocks when changes were requested and my team still owes a review", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "CHANGES_REQUESTED",
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result.state).toBe("blocking");
  });

  it("is optional when the base ref requires no review at all", () => {
    // PR 36548: a real CODEOWNERS request, but nothing gates merging on it.
    const result = computeCodeownerReview(mine, {
      reviewDecision: null,
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result).toEqual({ state: "optional", pendingTeams: ["squad-fe"], reviewedTeams: [] });
  });

  it("is optional once the PR's review requirements are already met", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "APPROVED",
      pendingTeams: owns,
      reviewedTeams: [],
    });
    expect(result.state).toBe("optional");
  });

  it("is optional when my team was hand-picked rather than owning the files", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: [{ slug: "squad-fe", asCodeOwner: false }],
      reviewedTeams: [],
    });
    expect(result.state).toBe("optional");
  });

  it("is reviewed once my team has reviewed", () => {
    const result = computeCodeownerReview(mine, {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: [],
      reviewedTeams: ["squad-fe"],
    });
    expect(result).toEqual({ state: "reviewed", pendingTeams: [], reviewedTeams: ["squad-fe"] });
  });

  it("still blocks when one of my teams reviewed but another owner has not", () => {
    const result = computeCodeownerReview(new Set(["squad-fe", "squad"]), {
      reviewDecision: "REVIEW_REQUIRED",
      pendingTeams: owns,
      reviewedTeams: ["squad"],
    });
    expect(result.state).toBe("blocking");
    expect(result.reviewedTeams).toEqual(["squad"]);
  });

  it("is none without teams or PR data", () => {
    expect(
      computeCodeownerReview(undefined, {
        reviewDecision: "REVIEW_REQUIRED",
        pendingTeams: owns,
        reviewedTeams: [],
      }).state
    ).toBe("none");
    expect(computeCodeownerReview(mine, undefined).state).toBe("none");
  });
});
