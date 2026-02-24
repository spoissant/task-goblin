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
import type { ReviewRequest } from "@/shared/types";

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
    async GET() {
      try {
        const config = await getGitHubConfig();
        const client = getGitHubClient();

        // Search for PRs where user is requested as reviewer
        const searchResult = await client.search.issuesAndPullRequests({
          q: `is:pr is:open review-requested:${config.username}`,
          per_page: 100,
        });

        const items: ReviewRequest[] = [];

        for (const item of searchResult.data.items) {
          // Extract owner/repo from repository_url
          const repoUrlParts = item.repository_url.split("/");
          const owner = repoUrlParts[repoUrlParts.length - 2];
          const repo = repoUrlParts[repoUrlParts.length - 1];
          const prNumber = item.number;

          // Fetch reviews to count approvals
          const reviewsResult = await client.pulls.listReviews({
            owner,
            repo,
            pull_number: prNumber,
          });

          // Count unique approving reviewers (latest state per user)
          const reviewerStates = new Map<string, string>();
          for (const review of reviewsResult.data) {
            if (review.user?.login && review.state) {
              reviewerStates.set(review.user.login, review.state);
            }
          }
          const approvedCount = Array.from(reviewerStates.values())
            .filter((state) => state === "APPROVED").length;

          const userState = reviewerStates.get(config.username);
          if (userState === "APPROVED") continue;

          const isDraft = item.draft ?? false;

          items.push({
            prNumber,
            title: item.title,
            url: item.html_url,
            repo: { owner, repo },
            author: item.user?.login ?? "unknown",
            state: isDraft ? "draft" : "open",
            isDraft,
            approvedCount,
            createdAt: item.created_at,
          });
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
};
