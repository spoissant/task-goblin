import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { pullRequests, repositories } from "../../db/schema";
import { getGitHubClient, getGitHubConfig, GitHubConfigError } from "../lib/github-client";
import { now } from "../lib/timestamp";

export interface SyncResult {
  synced: number;
  new: number;
  updated: number;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

interface PullRequestData {
  number: number;
  repositoryId: number;
  title: string;
  state: string;
  author: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  isDraft: number;
  checksStatus: string | null;
  reviewStatus: string | null;
  updatedAt: string;
}

function mapPrToData(
  pr: {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    merged?: boolean;
    user?: { login?: string } | null;
    head?: { ref?: string };
    base?: { ref?: string };
  },
  repositoryId: number
): PullRequestData {
  // Map state: GitHub has open/closed + merged boolean, we use open/closed/merged
  const state = pr.merged ? "merged" : pr.state;

  return {
    number: pr.number,
    repositoryId,
    title: pr.title,
    state,
    author: pr.user?.login || null,
    headBranch: pr.head?.ref || null,
    baseBranch: pr.base?.ref || null,
    isDraft: pr.draft ? 1 : 0,
    checksStatus: null, // Requires separate API call, skip for v1
    reviewStatus: null, // Requires separate API call, skip for v1
    updatedAt: now(),
  };
}

async function upsertPullRequest(
  data: PullRequestData
): Promise<"new" | "updated"> {
  const existing = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repositoryId, data.repositoryId),
        eq(pullRequests.number, data.number)
      )
    );

  if (existing.length > 0) {
    await db
      .update(pullRequests)
      .set({
        title: data.title,
        state: data.state,
        author: data.author,
        headBranch: data.headBranch,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        reviewStatus: data.reviewStatus,
        updatedAt: data.updatedAt,
      })
      .where(eq(pullRequests.id, existing[0].id));
    return "updated";
  } else {
    await db.insert(pullRequests).values(data);
    return "new";
  }
}

export async function syncGitHubPullRequests(): Promise<SyncResult> {
  const config = await getGitHubConfig();
  const client = getGitHubClient();

  // Get enabled repositories
  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.enabled, 1));

  if (repos.length === 0) {
    return { synced: 0, new: 0, updated: 0 };
  }

  // Build repo filter: (repo:owner/name OR repo:owner/name2 ...)
  const repoFilters = repos.map((r) => `repo:${r.owner}/${r.repo}`).join(" ");

  let synced = 0;
  let newCount = 0;
  let updatedCount = 0;

  try {
    // Search API: fetch only open PRs authored by user in configured repos
    const query = `is:pr is:open author:${config.username} ${repoFilters}`;

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await client.search.issuesAndPullRequests({
        q: query,
        per_page: 100,
        page,
      });

      for (const item of data.items) {
        // Extract owner/repo from repository_url
        const repoUrl = item.repository_url || "";
        const match = repoUrl.match(/repos\/([^/]+)\/([^/]+)$/);
        if (!match) continue;

        const [, owner, repoName] = match;
        const repo = repos.find((r) => r.owner === owner && r.repo === repoName);
        if (!repo) continue;

        // Fetch full PR to get head/base branch refs (search API doesn't include them)
        const { data: fullPr } = await client.pulls.get({
          owner,
          repo: repoName,
          pull_number: item.number,
        });

        const prData = mapPrToData(fullPr, repo.id);
        const result = await upsertPullRequest(prData);
        if (result === "new") newCount++;
        else updatedCount++;
        synced++;
      }

      hasMore = data.items.length === 100;
      page++;
    }
  } catch (err: unknown) {
    if (err instanceof GitHubConfigError) {
      throw err;
    }

    const error = err as { status?: number; message?: string };
    if (error.status === 401) {
      throw new GitHubApiError(
        "GitHub authentication failed. Check your GITHUB_TOKEN.",
        "GITHUB_AUTH_FAILED"
      );
    }
    if (error.status === 403) {
      throw new GitHubApiError(
        "GitHub rate limit exceeded or insufficient permissions.",
        "GITHUB_FORBIDDEN"
      );
    }
    if (error.status === 422) {
      throw new GitHubApiError(
        "Invalid search query. Check github_username setting.",
        "GITHUB_INVALID_QUERY"
      );
    }

    throw new GitHubApiError(
      error.message || "Failed to fetch PRs from GitHub",
      "GITHUB_API_ERROR"
    );
  }

  return { synced, new: newCount, updated: updatedCount };
}

export async function syncGitHubPullRequestByNumber(
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ status: "new" | "updated" }> {
  const client = getGitHubClient();

  // Find repository
  const repoResult = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.owner, owner), eq(repositories.repo, repo)));

  if (repoResult.length === 0) {
    throw new GitHubApiError(
      `Repository ${owner}/${repo} not configured`,
      "GITHUB_REPO_NOT_CONFIGURED"
    );
  }

  const repository = repoResult[0];

  try {
    const { data: pr } = await client.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const prData = mapPrToData(pr, repository.id);
    const status = await upsertPullRequest(prData);
    return { status };
  } catch (err: unknown) {
    if (err instanceof GitHubConfigError) {
      throw err;
    }

    const error = err as { status?: number; message?: string };
    if (error.status === 401) {
      throw new GitHubApiError(
        "GitHub authentication failed. Check your GITHUB_TOKEN.",
        "GITHUB_AUTH_FAILED"
      );
    }
    if (error.status === 404) {
      throw new GitHubApiError(
        `PR #${prNumber} not found in ${owner}/${repo}`,
        "GITHUB_PR_NOT_FOUND"
      );
    }

    throw new GitHubApiError(
      error.message || `Failed to fetch PR #${prNumber} from GitHub`,
      "GITHUB_API_ERROR"
    );
  }
}
