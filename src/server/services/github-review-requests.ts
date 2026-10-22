/**
 * The Reviews page's list: the open PRs requesting your review (directly or
 * through one of your teams), or your own open PRs, with their review state,
 * size, and the task tracking each.
 */
import { eq, isNotNull } from "drizzle-orm";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import { getGitHubClient, getGitHubConfig, toGitHubError } from "../lib/github-client";
import { getSetting } from "../lib/settings";
import { fetchPullRequestReviewInfo, prKey, type GqlPrReviewInfo, type PrTarget } from "./github-graphql";
import { fetchMyTeams, selectCodeownerTeams } from "./github-teams";
import { bucketFilesByCategory } from "@/shared/file-categories";
import { CODEOWNER_TEAMS_SETTING } from "@/shared/settings-keys";
import type { GitHubTeam, ReviewRequest } from "@/shared/types";

type GitHubClient = ReturnType<typeof getGitHubClient>;
type SearchItem = RestEndpointMethodTypes["search"]["issuesAndPullRequests"]["response"]["data"]["items"][number];
type TaskRef = { id: number; jiraKey: string | null };

export type ReviewScope = "mine" | "others";

export interface ReviewContext {
  scope: ReviewScope;
  username: string;
  /** Teams flagged as yours when they're a missing code owner, keyed by org. */
  codeownerTeamsByOrg: Map<string, Set<string>>;
  taskByPr: Map<string, TaskRef>;
}

/**
 * Resolve to null instead of rejecting, so a failed batched fetch degrades the
 * affected columns rather than taking the whole review list down with it.
 */
async function orNull<T>(label: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`review-requests: ${label} unavailable — ${(err as Error).message}`);
    return null;
  }
}

/** Your open PRs, or the open PRs requesting your review or one of your teams'. */
export function searchQueries(scope: ReviewScope, username: string, teams: GitHubTeam[]): string[] {
  if (scope === "mine") return [`is:pr is:open author:${username}`];
  // GitHub doesn't request a review from a PR's author directly, but a team
  // request can include them: those PRs are left out.
  return [
    `is:pr is:open review-requested:${username}`,
    ...teams.map((t) => `is:pr is:open team-review-requested:${t.org}/${t.slug} -author:${username}`),
  ];
}

/**
 * Every search's hits, once each. One team's search failing shouldn't blank the
 * board; every search failing must not read as "nothing to review", so that throws.
 */
async function searchPrs(client: GitHubClient, queries: string[]): Promise<SearchItem[]> {
  // `search.issuesAndPullRequests` is deprecated (and logs on every
  // call); the raw route with `advanced_search` is its replacement.
  const results = await Promise.allSettled(
    queries.map((q) => client.request("GET /search/issues", { q, per_page: 100, advanced_search: "true" }))
  );
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (rejected.length === results.length) throw toGitHubError(rejected[0].reason, "GitHub search failed");
  for (const r of rejected) {
    console.warn(`review-requests: a review search failed — ${r.reason?.message ?? r.reason}`);
  }

  const byUrl = new Map<string, SearchItem>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.data.items) {
      if (!byUrl.has(item.html_url)) byUrl.set(item.html_url, item);
    }
  }
  return [...byUrl.values()];
}

/** The task tracking each PR, keyed by "owner/repo#number". */
async function tasksByPr(): Promise<Map<string, TaskRef>> {
  const rows = await db
    .select({ id: tasks.id, jiraKey: tasks.jiraKey, prNumber: tasks.prNumber, owner: repositories.owner, repo: repositories.repo })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(isNotNull(tasks.prNumber));
  return new Map(rows.map((t) => [prKey(t.owner, t.repo, t.prNumber ?? 0), { id: t.id, jiraKey: t.jiraKey }]));
}

function targetOf(item: SearchItem): PrTarget {
  const parts = item.repository_url.split("/");
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1], number: item.number };
}

/**
 * A search hit as a review row. A missing `info` (inaccessible repo, deleted PR,
 * failed batch) leaves the row to the search hit alone, its extras unknown.
 * Null for someone else's PR you already approved.
 */
export function toReviewRequest(item: SearchItem, target: PrTarget, info: GqlPrReviewInfo | null, ctx: ReviewContext): ReviewRequest | null {
  const { owner, repo, number: prNumber } = target;
  const mine = (info?.reviews ?? []).filter((review) => review.authorLogin === ctx.username);
  // Without the reviews we can't tell, so the PR stays listed.
  if (ctx.scope === "others" && mine.at(-1)?.state === "APPROVED") return null;

  const isDraft = item.draft ?? false;
  const task = ctx.taskByPr.get(prKey(owner, repo, prNumber));
  return {
    prNumber,
    title: item.title,
    url: item.html_url,
    repo: { owner, repo },
    author: item.user?.login ?? "unknown",
    assignees: (item.assignees ?? []).map((a) => a.login),
    state: isDraft ? "draft" : "open",
    isDraft,
    // null, not a guess, when the PR's reviews are unavailable —
    // "unknown" must not read as ready or as blocked.
    reviewStatus: info?.reviewStatus ?? null,
    myMissingCodeOwners: (info?.reviewStatus.missingCodeOwners ?? []).filter(
      (name) => name === ctx.username || ctx.codeownerTeamsByOrg.get(owner)?.has(name)
    ),
    // GitHub only returns PENDING (unsubmitted draft) reviews to their author,
    // i.e. the token user — so this flags your own draft.
    hasPendingReview: mine.some((review) => review.state === "PENDING"),
    createdAt: item.created_at,
    changedFiles: info?.changedFiles ?? null,
    additions: info?.additions ?? null,
    deletions: info?.deletions ?? null,
    changesByCategory: info ? bucketFilesByCategory(info.files) : null,
    taskId: task?.id ?? null,
    taskJiraKey: task?.jiraKey ?? null,
  };
}

export async function listReviewRequests(scope: ReviewScope): Promise<ReviewRequest[]> {
  const { username } = await getGitHubConfig();
  const client = getGitHubClient();
  // Drives both the team searches and which missing code owners are flagged
  // as yours; empty when the token lacks read:org.
  const myTeams = await fetchMyTeams(client);
  const hits = await searchPrs(client, searchQueries(scope, username, myTeams));
  const targets = hits.map(targetOf);

  // Batched over all PRs (~25 per query, bounded concurrency) instead of
  // firing REST calls per PR — the unbounded per-PR fan-out tripped GitHub's
  // secondary rate limit on busy boards.
  const [infos, taskByPr, codeownerSetting] = await Promise.all([
    orNull("review info", fetchPullRequestReviewInfo(client, targets)),
    tasksByPr(),
    getSetting(CODEOWNER_TEAMS_SETTING),
  ]);
  const ctx: ReviewContext = {
    scope,
    username,
    codeownerTeamsByOrg: selectCodeownerTeams(myTeams, codeownerSetting),
    taskByPr,
  };
  return hits.flatMap((hit, i) => {
    const target = targets[i];
    const row = toReviewRequest(hit, target, infos?.get(prKey(target.owner, target.repo, target.number)) ?? null, ctx);
    return row ? [row] : [];
  });
}
