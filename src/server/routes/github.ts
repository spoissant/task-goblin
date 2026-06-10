import { db } from "../../db";
import { repositories } from "../../db/schema";
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
import { backfillDescriptions } from "../services/backfill-descriptions";
import { autoMatchAndMerge } from "../services/task-merge";
import type { Routes } from "../router";
import type { ReviewRequest, FileChanges, PrChangesByCategory, FileChangesWithPercent } from "@/shared/types";
import { categorizePrSize } from "@/shared/pr-size";

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

  "/api/v1/github/review-requests": {
    async GET(req) {
      try {
        const config = await getGitHubConfig();
        const client = getGitHubClient();
        const scope = new URL(req.url).searchParams.get("scope") === "mine" ? "mine" : "others";

        let queries: string[];
        if (scope === "mine") {
          queries = [`is:pr is:open author:${config.username}`];
        } else {
          // Search for PRs where user is requested directly, plus PRs requested
          // from any team the user belongs to. Team membership requires read:org
          // scope on the token; if unavailable we silently fall back to user-only.
          let teamQueries: string[] = [];
          try {
            const teamsResp = await client.teams.listForAuthenticatedUser({ per_page: 100 });
            teamQueries = teamsResp.data.map(
              (t) => `is:pr is:open team-review-requested:${t.organization.login}/${t.slug}`
            );
          } catch {
            // ignore — fall back to user-only search
          }

          // Exclude PRs the user authored — only happens for team requests since
          // GitHub doesn't request a review from the PR author directly.
          const excludeAuthor = `-author:${config.username}`;
          queries = [
            `is:pr is:open review-requested:${config.username}`,
            ...teamQueries.map((q) => `${q} ${excludeAuthor}`),
          ];
        }

        const searchResults = await Promise.all(
          queries.map((q) => client.search.issuesAndPullRequests({ q, per_page: 100 }))
        );

        const seen = new Set<string>();
        const searchItems: typeof searchResults[number]["data"]["items"] = [];
        for (const result of searchResults) {
          for (const item of result.data.items) {
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

        const results = await Promise.all(
          searchItems.map(async (item) => {
            // Extract owner/repo from repository_url
            const repoUrlParts = item.repository_url.split("/");
            const owner = repoUrlParts[repoUrlParts.length - 2];
            const repo = repoUrlParts[repoUrlParts.length - 1];
            const prNumber = item.number;

            // Fetch reviews, PR details, and file list in parallel
            const [reviewsResult, prDetails, filesResult] = await Promise.all([
              client.pulls.listReviews({ owner, repo, pull_number: prNumber }),
              client.pulls.get({ owner, repo, pull_number: prNumber }),
              client.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 300 }),
            ]);

            // Count unique approving reviewers (latest state per user)
            const reviewerStates = new Map<string, string>();
            for (const review of reviewsResult.data) {
              if (review.user?.login && review.state) {
                reviewerStates.set(review.user.login, review.state);
              }
            }
            const approvedCount = Array.from(reviewerStates.values())
              .filter((state) => state === "APPROVED").length;

            // Hide PRs the user already approved — only relevant for others' PRs.
            const userState = reviewerStates.get(config.username);
            if (scope === "others" && userState === "APPROVED") return null;

            const isDraft = item.draft ?? false;

            const empty = (): FileChanges => ({ files: 0, additions: 0, deletions: 0 });
            const changesByCategory = { frontend: empty(), backend: empty(), other: empty() };
            for (const file of filesResult.data) {
              const cat = categorizeFile(file.filename);
              changesByCategory[cat].files++;
              changesByCategory[cat].additions += file.additions;
              changesByCategory[cat].deletions += file.deletions;
            }

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
              createdAt: item.created_at,
              changedFiles: prDetails.data.changed_files ?? null,
              additions: prDetails.data.additions ?? null,
              deletions: prDetails.data.deletions ?? null,
              changesByCategory,
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

        const empty = (): FileChanges => ({ files: 0, additions: 0, deletions: 0 });
        const buckets = { frontend: empty(), backend: empty(), other: empty() };
        let totalAdditions = 0;
        let totalDeletions = 0;

        for (const file of filesResult.data) {
          const cat = categorizeFile(file.filename);
          buckets[cat].files += 1;
          buckets[cat].additions += file.additions;
          buckets[cat].deletions += file.deletions;
          totalAdditions += file.additions;
          totalDeletions += file.deletions;
        }

        const totalFiles = buckets.frontend.files + buckets.backend.files + buckets.other.files;
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
