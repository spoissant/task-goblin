import type { getGitHubClient } from "../lib/github-client";
import type { GitHubTeam } from "@/shared/types";

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
 * Team slugs that count as "mine" when the Reviews column flags a missing
 * code owner, keyed by org so a slug can only match PRs in the org that team
 * belongs to.
 *
 * No stored selection means every team the user belongs to counts, so the
 * flag works before it is ever configured. An empty stored list is a
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
