import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { pullRequests, branches, repositories } from "../../db/schema";
import { json, noContent } from "../response";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { GitHubConfigError } from "../lib/github-client";
import {
  syncGitHubPullRequests,
  syncGitHubPullRequestByNumber,
  GitHubApiError,
} from "../services/github-sync";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const githubRoutes: Routes = {
  "/api/v1/github/pull-requests": {
    async GET(req) {
      const url = new URL(req.url);
      const repositoryId = url.searchParams.get("repositoryId");
      const state = url.searchParams.get("state");

      let query = db.select().from(pullRequests);

      if (repositoryId) {
        const items = await db
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.repositoryId, parseInt(repositoryId, 10)));

        const filtered = state
          ? items.filter((pr) => pr.state === state)
          : items;

        return json({ items: filtered, total: filtered.length });
      }

      const items = await db.select().from(pullRequests);
      const filtered = state
        ? items.filter((pr) => pr.state === state)
        : items;

      return json({ items: filtered, total: filtered.length });
    },
  },

  "/api/v1/github/pull-requests/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, id));

      if (result.length === 0) {
        throw new NotFoundError("PullRequest", id);
      }

      const pr = result[0];

      // Get related repository
      const repoResult = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, pr.repositoryId));

      // Get linked branches
      const linkedBranches = await db
        .select()
        .from(branches)
        .where(eq(branches.pullRequestId, id));

      return json({
        ...pr,
        repository: repoResult[0] || null,
        branches: linkedBranches,
      });
    },
  },

  "/api/v1/github/pull-requests/:id/link": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.branchId || typeof body.branchId !== "number") {
        throw new ValidationError("branchId is required and must be a number");
      }

      const existing = await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("PullRequest", id);
      }

      // Verify branch exists
      const branchResult = await db
        .select()
        .from(branches)
        .where(eq(branches.id, body.branchId));
      if (branchResult.length === 0) {
        throw new ValidationError(`Branch with id ${body.branchId} not found`);
      }

      // Update branch to link to this PR
      await db
        .update(branches)
        .set({ pullRequestId: id })
        .where(eq(branches.id, body.branchId));

      const result = await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, id));

      return json(result[0]);
    },
  },

  "/api/v1/github/pull-requests/:id/unlink": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.branchId || typeof body.branchId !== "number") {
        throw new ValidationError("branchId is required and must be a number");
      }

      const existing = await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("PullRequest", id);
      }

      // Unlink branch from this PR
      await db
        .update(branches)
        .set({ pullRequestId: null })
        .where(eq(branches.id, body.branchId));

      return json(existing[0]);
    },
  },

  "/api/v1/github/repos/:owner/:repo/pull-requests/:number": {
    async GET(req, params) {
      const { owner, repo, number } = params;
      const prNumber = parseInt(number, 10);

      // Find repository
      const repoResult = await db
        .select()
        .from(repositories)
        .where(and(eq(repositories.owner, owner), eq(repositories.repo, repo)));

      if (repoResult.length === 0) {
        throw new NotFoundError("Repository", `${owner}/${repo}`);
      }

      const repository = repoResult[0];

      // Find PR
      const result = await db
        .select()
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.repositoryId, repository.id),
            eq(pullRequests.number, prNumber)
          )
        );

      if (result.length === 0) {
        throw new NotFoundError("PullRequest", `${owner}/${repo}#${prNumber}`);
      }

      const pr = result[0];

      // Get linked branches
      const linkedBranches = await db
        .select()
        .from(branches)
        .where(eq(branches.pullRequestId, pr.id));

      return json({ ...pr, repository, branches: linkedBranches });
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
    async POST(req, params) {
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
};
