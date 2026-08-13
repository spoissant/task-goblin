import type { getGitHubClient } from "../lib/github-client";
import type { GqlPrTeamReviews } from "./github-graphql";
import type { CodeownerReview, GitHubTeam } from "@/shared/types";

type GitHubClient = ReturnType<typeof getGitHubClient>;

/**
 * Teams the token user belongs to. Requires `read:org` on the token; without it
 * GitHub errors rather than returning a subset, so degrade to no team data.
 */
export async function fetchMyTeams(client: GitHubClient): Promise<GitHubTeam[]> {
  try {
    const resp = await client.teams.listForAuthenticatedUser({ per_page: 100 });
    return resp.data.map((t) => ({
      org: t.organization.login,
      slug: t.slug,
      name: t.name,
    }));
  } catch {
    return [];
  }
}

/** Parse the stored slug list. Absent or malformed means "no narrowing". */
function parseSelectedSlugs(setting: string | null): Set<string> | null {
  if (!setting) return null;
  try {
    const parsed = JSON.parse(setting);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return null;
  }
}

/**
 * Team slugs that count as "mine" for the codeowner column, keyed by org so a
 * slug can only match PRs in the org that team belongs to.
 *
 * No stored selection means every team the user belongs to counts, so the
 * column works before it is ever configured. An empty stored list is a
 * deliberate opt-out and matches nothing.
 */
export function selectCodeownerTeams(
  teams: GitHubTeam[],
  setting: string | null
): Map<string, Set<string>> {
  const selected = parseSelectedSlugs(setting);
  const byOrg = new Map<string, Set<string>>();
  for (const team of teams) {
    if (selected && !selected.has(team.slug)) continue;
    if (!byOrg.has(team.org)) byOrg.set(team.org, new Set());
    byOrg.get(team.org)!.add(team.slug);
  }
  return byOrg;
}

const NO_CODEOWNER: CodeownerReview = { state: "none", pendingTeams: [], reviewedTeams: [] };

/**
 * Review decisions that mean the PR still owes a review it can't merge without.
 * APPROVED means the requirements are met, null that the base ref has none — in
 * both cases an open team request is a courtesy, not a gate.
 */
const REVIEWS_OUTSTANDING = new Set(["REVIEW_REQUIRED", "CHANGES_REQUESTED"]);

/**
 * Cross the user's teams with a PR's team review state.
 *
 * Only a CODEOWNERS request on a PR that GitHub says still owes a required
 * review actually holds up the merge. A hand-picked team request, or any request
 * on a PR whose review requirements are already met (or that has none), is
 * reported as optional so it doesn't read as a blocker.
 */
export function computeCodeownerReview(
  myTeams: Set<string> | undefined,
  prTeams: GqlPrTeamReviews | undefined
): CodeownerReview {
  if (!myTeams?.size || !prTeams) return NO_CODEOWNER;

  const mine = prTeams.pendingTeams.filter((t) => myTeams.has(t.slug));
  const pendingTeams = mine.map((t) => t.slug);
  const reviewedTeams = prTeams.reviewedTeams.filter((slug) => myTeams.has(slug));

  const blocking =
    REVIEWS_OUTSTANDING.has(prTeams.reviewDecision ?? "") && mine.some((t) => t.asCodeOwner);
  if (blocking) return { state: "blocking", pendingTeams, reviewedTeams };
  if (reviewedTeams.length) return { state: "reviewed", pendingTeams, reviewedTeams };
  if (pendingTeams.length) return { state: "optional", pendingTeams, reviewedTeams };
  return NO_CODEOWNER;
}
