import { describe, it, expect } from "bun:test";
import { selectCodeownerTeams } from "./github-teams";
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
