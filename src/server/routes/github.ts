import { json } from "../response";
import { AppError } from "../lib/errors";
import { GitHubConfigError } from "../lib/github-client";
import { JiraConfigError } from "../lib/jira-client";
import {
  syncGitHubPullRequests,
  syncGitHubPullRequestByNumber,
  GitHubApiError,
} from "../services/github-sync";
import { syncJiraItems, syncJiraItemByKey, JiraApiError } from "../services/jira-sync";
import { backfillDescriptions } from "../services/backfill-descriptions";
import type { Routes } from "../router";

export const githubRoutes: Routes = {
  "/api/v1/refresh/jira": {
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

  "/api/v1/refresh/github": {
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

  "/api/v1/refresh/github/:owner/:repo/:number": {
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

  "/api/v1/refresh/jira/:key": {
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
};
