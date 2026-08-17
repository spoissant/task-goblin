import { eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { repositories, settings, tasks } from "../../db/schema";
import { json } from "../response";
import { AppError } from "../lib/errors";
import { getGitHubClient, getGitHubConfig, GitHubConfigError } from "../lib/github-client";
import { JiraConfigError } from "../lib/jira-client";
import {
  syncGitHubPullRequests,
  syncGitHubPullRequestByNumber,
  GitHubApiError,
} from "../services/github-sync";
import { syncJiraItems, syncJiraItemByKey, JiraApiError } from "../services/jira-sync";
import { fetchPullRequestTeamReviews, prKey, type GqlPrTeamReviews } from "../services/github-graphql";
import {
  computeCodeownerReview,
  fetchMyTeams,
  selectCodeownerTeams,
} from "../services/github-teams";
import { backfillDescriptions } from "../services/backfill-descriptions";
import { autoMatchAndMerge } from "../services/task-merge";
import type { Routes } from "../router";
import type { ReviewRequest, FileChanges, PrChangesByCategory, FileChangesWithPercent } from "@/shared/types";
import { categorizePrSize } from "@/shared/pr-size";
import { CODEOWNER_TEAMS_SETTING } from "@/shared/settings-keys";

function categorizeFile(filename: string): "frontend" | "backend" | "other" {
  const lower = filename.toLowerCase();

  if (/\.(js|jsx|ts|tsx|vue|haml)$/.test(lower)) return "frontend";
  if (/\.(css|scss|sass|less)$/.test(lower)) return "frontend";
  if (/\.(rb|rake|gemspec|rabl)$/.test(lower)) return "backend";
  if (lower === "gemfile" || lower === "gemfile.lock") return "backend";

  const frontendPaths = ["frontend/", "front/", "app/javascript/", "client/", "packages/"];
  const backendPaths = ["app/models/", "app/controllers/", "app/services/", "app/workers/", "app/mailers/", "app/helpers/", "lib/", "db/", "config/", "spec/", "test/"];

  if (frontendPaths.some((p) => lower.startsWith(p))) return "frontend";
  if (backendPaths.some((p) => lower.startsWith(p))) return "backend";

  return "other";
}

type FileBuckets = { frontend: FileChanges; backend: FileChanges; other: FileChanges };

function bucketFilesByCategory(
  files: Array<{ filename: string; additions: number; deletions: number }>
): FileBuckets {
  const empty = (): FileChanges => ({ files: 0, additions: 0, deletions: 0 });
  const buckets: FileBuckets = { frontend: empty(), backend: empty(), other: empty() };
  for (const file of files) {
    const cat = categorizeFile(file.filename);
    buckets[cat].files += 1;
    buckets[cat].additions += file.additions;
    buckets[cat].deletions += file.deletions;
  }
  return buckets;
}

/**
 * Resolve to null instead of rejecting, so one PR's failed sub-fetch degrades
 * that PR's row rather than taking the whole review list down with it.
 */
async function orNull<T>(label: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`review-requests: ${label} unavailable — ${(err as Error).message}`);
    return null;
  }
}

// Largest-remainder rounding so percentages sum to 100 (when totalFiles > 0).
function computePercents(buckets: { frontend: FileChanges; backend: FileChanges; other: FileChanges }, totalFiles: number): { frontend: number; backend: number; other: number } {
  if (totalFiles === 0) return { frontend: 0, backend: 0, other: 0 };

  const raw = {
    frontend: (buckets.frontend.files / totalFiles) * 100,
    backend: (buckets.backend.files / totalFiles) * 100,
    other: (buckets.other.files / totalFiles) * 100,
  };
  const floored = {
    frontend: Math.floor(raw.frontend),
    backend: Math.floor(raw.backend),
    other: Math.floor(raw.other),
  };
  let remaining = 100 - (floored.frontend + floored.backend + floored.other);
  // Sort by largest fractional remainder, distribute the remaining 1-percent units.
  const remainders = (Object.entries(raw) as Array<[keyof typeof raw, number]>)
    .map(([k, v]) => [k, v - Math.floor(v)] as const)
    .sort((a, b) => b[1] - a[1]);
  const result = { ...floored };
  for (const [key] of remainders) {
    if (remaining <= 0) break;
    result[key] += 1;
    remaining -= 1;
  }
  return result;
}

export const githubRoutes: Routes = {
  "/api/v1/sync/jira": {
    async POST() {
      try {
        const result = await syncJiraItems();
        return json(result);
      } catch (err) {
        if (err instanceof JiraConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof JiraApiError) {
          const statusCode = err.code === "JIRA_AUTH_FAILED" ? 401 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/sync/github": {
    async POST() {
      try {
        const result = await syncGitHubPullRequests();
        return json(result);
      } catch (err) {
        if (err instanceof GitHubConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof GitHubApiError) {
          const statusCode =
            err.code === "GITHUB_AUTH_FAILED" ? 401 :
            err.code === "GITHUB_FORBIDDEN" ? 403 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/sync/match": {
    async POST() {
      const merged = await autoMatchAndMerge();
      return json({ merged });
    },
  },

  "/api/v1/sync/github/:owner/:repo/:number": {
    async POST(_req, params) {
      const { owner, repo, number } = params;
      const prNumber = parseInt(number, 10);

      try {
        const result = await syncGitHubPullRequestByNumber(owner, repo, prNumber);
        return json(result);
      } catch (err) {
        if (err instanceof GitHubConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof GitHubApiError) {
          const statusCode =
            err.code === "GITHUB_AUTH_FAILED" ? 401 :
            err.code === "GITHUB_PR_NOT_FOUND" ? 404 :
            err.code === "GITHUB_REPO_NOT_CONFIGURED" ? 400 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/sync/jira/:key": {
    async POST(_req, params) {
      const { key } = params;

      try {
        const result = await syncJiraItemByKey(key);
        return json(result);
      } catch (err) {
        if (err instanceof JiraConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof JiraApiError) {
          const statusCode =
            err.code === "JIRA_AUTH_FAILED" ? 401 :
            err.code === "JIRA_ISSUE_NOT_FOUND" ? 404 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/backfill/descriptions": {
    async POST() {
      const result = await backfillDescriptions();
      return json(result);
    },
  },

  "/api/v1/github/teams": {
    async GET() {
      try {
        const items = await fetchMyTeams(getGitHubClient());
        return json({ items, total: items.length });
      } catch (err) {
        if (err instanceof GitHubConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/github/review-requests": {
    async GET(req) {
      try {
        const config = await getGitHubConfig();
        const client = getGitHubClient();
        const scope = new URL(req.url).searchParams.get("scope") === "mine" ? "mine" : "others";

        // Drives both the team-review-requested searches below and the codeowner
        // column; empty when the token lacks read:org.
        const myTeams = await fetchMyTeams(client);

        let queries: string[];
        if (scope === "mine") {
          queries = [`is:pr is:open author:${config.username}`];
        } else {
          // Search for PRs where user is requested directly, plus PRs requested
          // from any team the user belongs to.
          // Exclude PRs the user authored — only happens for team requests since
          // GitHub doesn't request a review from the PR author directly.
          const excludeAuthor = `-author:${config.username}`;
          queries = [
            `is:pr is:open review-requested:${config.username}`,
            ...myTeams.map(
              (t) =>
                `is:pr is:open team-review-requested:${t.org}/${t.slug} ${excludeAuthor}`
            ),
          ];
        }

        type SearchItem =
          Awaited<ReturnType<typeof client.search.issuesAndPullRequests>>["data"]["items"][number];

        const searchResults = await Promise.allSettled(
          queries.map((q) => client.search.issuesAndPullRequests({ q, per_page: 100 }))
        );

        // One team's query failing shouldn't blank the board. Every query
        // failing must not read as "nothing to review", so that still throws.
        const rejected = searchResults.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected"
        );
        if (rejected.length === searchResults.length) {
          throw rejected[0].reason;
        }
        for (const r of rejected) {
          console.warn(`review-requests: a review search failed — ${r.reason?.message ?? r.reason}`);
        }

        const seen = new Set<string>();
        const searchItems: SearchItem[] = [];
        for (const result of searchResults) {
          if (result.status !== "fulfilled") continue;
          for (const item of result.value.data.items) {
            if (seen.has(item.html_url)) continue;
            seen.add(item.html_url);
            searchItems.push(item);
          }
        }

        const items: ReviewRequest[] = [];

        // Per-repo required-reviews threshold, keyed by "owner/repo" (default 2)
        const repoRows = await db.select().from(repositories);
        const requiredReviewsByRepo = new Map<string, number>(
          repoRows.map((r) => [`${r.owner}/${r.repo}`, r.requiredReviews ?? 2])
        );

        // Existing task per PR, keyed by "owner/repo#number"
        const repoSlugById = new Map<number, string>(
          repoRows.map((r) => [r.id, `${r.owner}/${r.repo}`])
        );
        const taskRows = await db
          .select({ id: tasks.id, jiraKey: tasks.jiraKey, prNumber: tasks.prNumber, repositoryId: tasks.repositoryId })
          .from(tasks)
          .where(isNotNull(tasks.prNumber));
        const taskByPr = new Map<string, { id: number; jiraKey: string | null }>();
        for (const t of taskRows) {
          if (t.repositoryId == null) continue;
          const slug = repoSlugById.get(t.repositoryId);
          if (slug) taskByPr.set(`${slug}#${t.prNumber}`, { id: t.id, jiraKey: t.jiraKey });
        }

        // Teams whose CODEOWNERS reviews the column tracks, keyed by org.
        const codeownerSetting = await db
          .select()
          .from(settings)
          .where(eq(settings.key, CODEOWNER_TEAMS_SETTING));
        const codeownerTeamsByOrg = selectCodeownerTeams(myTeams, codeownerSetting[0]?.value ?? null);

        // owner/repo/number per hit, shared by the batched team-review fetch below.
        const prTargets = searchItems.map((item) => {
          const parts = item.repository_url.split("/");
          return {
            owner: parts[parts.length - 2],
            repo: parts[parts.length - 1],
            number: item.number,
          };
        });

        // Batched over all PRs (~25 per query) rather than per PR. Awaited inside
        // the per-PR fan-out below so it overlaps the REST calls instead of
        // delaying them; skipped entirely when no team is configured.
        const teamReviewsPromise = codeownerTeamsByOrg.size
          ? orNull("team reviews", fetchPullRequestTeamReviews(client, prTargets)).then(
              (m) => m ?? new Map<string, GqlPrTeamReviews>()
            )
          : Promise.resolve(new Map<string, GqlPrTeamReviews>());

        const results = await Promise.all(
          searchItems.map(async (item, idx) => {
            const { owner, repo, number: prNumber } = prTargets[idx];
            const slug = `${owner}/${repo}#${prNumber}`;

            // Fetch reviews, PR details, and file list in parallel. Each one
            // degrades on its own: the row still renders with whatever the
            // other calls returned, with the missing parts shown as unknown.
            const [reviewsResult, prDetails, filesResult, teamReviews] = await Promise.all([
              orNull(`${slug} reviews`, client.pulls.listReviews({ owner, repo, pull_number: prNumber })),
              orNull(`${slug} details`, client.pulls.get({ owner, repo, pull_number: prNumber })),
              orNull(`${slug} files`, client.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 300 })),
              teamReviewsPromise,
            ]);

            // Count unique approving reviewers (latest state per user)
            const reviewerStates = new Map<string, string>();
            for (const review of reviewsResult?.data ?? []) {
              if (review.user?.login && review.state) {
                reviewerStates.set(review.user.login, review.state);
              }
            }
            // null, not 0, when reviews are unavailable — "no approvals" and
            // "unknown" must not look the same to whoever reads the column.
            const approvedCount = reviewsResult
              ? Array.from(reviewerStates.values()).filter((state) => state === "APPROVED").length
              : null;

            // GitHub only returns PENDING (unsubmitted draft) reviews to their author,
            // i.e. the authenticated token user — so this flags the current user's own draft.
            const hasPendingReview = (reviewsResult?.data ?? []).some(
              (review) => review.state === "PENDING" && review.user?.login === config.username
            );

            // Hide PRs the user already approved — only relevant for others' PRs.
            // Without the reviews we can't tell, so the PR stays listed.
            const userState = reviewerStates.get(config.username);
            if (scope === "others" && userState === "APPROVED") return null;

            const isDraft = item.draft ?? false;

            const changesByCategory = filesResult ? bucketFilesByCategory(filesResult.data) : null;

            return {
              prNumber,
              title: item.title,
              url: item.html_url,
              repo: { owner, repo },
              author: item.user?.login ?? "unknown",
              state: isDraft ? "draft" : "open",
              isDraft,
              approvedCount,
              requiredReviews: requiredReviewsByRepo.get(`${owner}/${repo}`) ?? 2,
              hasPendingReview,
              codeowner: computeCodeownerReview(
                codeownerTeamsByOrg.get(owner),
                teamReviews.get(prKey(owner, repo, prNumber))
              ),
              createdAt: item.created_at,
              changedFiles: prDetails?.data.changed_files ?? null,
              additions: prDetails?.data.additions ?? null,
              deletions: prDetails?.data.deletions ?? null,
              changesByCategory,
              taskId: taskByPr.get(`${owner}/${repo}#${prNumber}`)?.id ?? null,
              taskJiraKey: taskByPr.get(`${owner}/${repo}#${prNumber}`)?.jiraKey ?? null,
            } satisfies ReviewRequest;
          })
        );

        for (const item of results) {
          if (item !== null) items.push(item);
        }

        return json({ items, total: items.length });
      } catch (err) {
        if (err instanceof GitHubConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/github/pull-requests/:owner/:repo/:number/changes-by-category": {
    async GET(_req, params) {
      const { owner, repo, number } = params;
      const prNumber = parseInt(number, 10);
      if (Number.isNaN(prNumber)) {
        throw new AppError("Invalid PR number", 400, "INVALID_PR_NUMBER");
      }

      try {
        const client = getGitHubClient();
        const filesResult = await client.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 300 });

        const buckets = bucketFilesByCategory(filesResult.data);
        const sum = (pick: (b: FileChanges) => number) =>
          pick(buckets.frontend) + pick(buckets.backend) + pick(buckets.other);

        const totalAdditions = sum((b) => b.additions);
        const totalDeletions = sum((b) => b.deletions);
        const totalFiles = sum((b) => b.files);
        const percents = computePercents(buckets, totalFiles);

        const withPercent = (b: FileChanges, percent: number): FileChangesWithPercent => ({ ...b, percent });

        const response: PrChangesByCategory = {
          totalFiles,
          totalAdditions,
          totalDeletions,
          size: categorizePrSize(totalFiles, totalAdditions, totalDeletions),
          frontend: withPercent(buckets.frontend, percents.frontend),
          backend: withPercent(buckets.backend, percents.backend),
          other: withPercent(buckets.other, percents.other),
        };

        return json(response);
      } catch (err) {
        if (err instanceof GitHubConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        throw err;
      }
    },
  },
};
