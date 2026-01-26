import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories, logs } from "../../db/schema";
import { getGitHubClient, getGitHubConfig, GitHubConfigError } from "../lib/github-client";
import { now } from "../lib/timestamp";
import { mapPrToTaskData } from "./github-mappers";
import {
  fetchApprovedReviewCount,
  fetchUnresolvedCommentCount,
  fetchCheckRunsStatus,
  detectDeploymentBranches,
} from "./github-fetchers";
import { upsertPrTask } from "./github-upsert";
import { isApiError } from "../lib/errors";

export interface SyncResult {
  synced: number;
  new: number;
  updated: number;
  unchanged: number;
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

export async function syncGitHubPullRequests(): Promise<SyncResult> {
  const config = await getGitHubConfig();
  const client = getGitHubClient();

  // Get enabled repositories
  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.enabled, 1));

  if (repos.length === 0) {
    return { synced: 0, new: 0, updated: 0, unchanged: 0 };
  }

  // Build lookup maps for O(1) repo access
  const reposByKey = new Map(repos.map((r) => [`${r.owner}/${r.repo}`, r]));
  const reposById = new Map(repos.map((r) => [r.id, r]));

  // Build repo filter: (repo:owner/name OR repo:owner/name2 ...)
  const repoFilters = repos.map((r) => `repo:${r.owner}/${r.repo}`).join(" ");

  let synced = 0;
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const syncedPrs = new Set<string>();

  try {
    // Search API: fetch only open PRs authored by user in configured repos
    const query = `is:pr is:open author:${config.username} ${repoFilters}`;

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await client.request("GET /search/issues", {
        q: query,
        per_page: 100,
        page,
      });

      // Filter items to valid PRs with matching repos
      const validItems = data.items
        .map((item) => {
          const repoUrl = item.repository_url || "";
          const match = repoUrl.match(/repos\/([^/]+)\/([^/]+)$/);
          if (!match) return null;
          const [, owner, repoName] = match;
          const repo = reposByKey.get(`${owner}/${repoName}`);
          if (!repo) return null;
          return { item, owner, repoName, repo };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // Process PRs in batches for parallel API calls
      const BATCH_SIZE = 10;
      for (let i = 0; i < validItems.length; i += BATCH_SIZE) {
        const batch = validItems.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async ({ item, owner, repoName, repo }) => {
            syncedPrs.add(`${repo.id}:${item.number}`);

            // Fetch full PR to get head/base branch refs (search API doesn't include them)
            const { data: fullPr } = await client.pulls.get({
              owner,
              repo: repoName,
              pull_number: item.number,
            });

            // Parse deployment branches for this repo
            const deploymentBranches: string[] = repo.deploymentBranches
              ? JSON.parse(repo.deploymentBranches)
              : [];

            // Fetch approved review count, check runs, deployment branches, and unresolved comments in parallel
            const [approvedCount, checksResult, onDeploymentBranches, unresolvedCount] = await Promise.all([
              fetchApprovedReviewCount(client, owner, repoName, item.number),
              fullPr.head?.sha
                ? fetchCheckRunsStatus(client, owner, repoName, fullPr.head.sha)
                : Promise.resolve({ checksStatus: null, checksDetails: null }),
              fullPr.head?.ref && deploymentBranches.length > 0
                ? detectDeploymentBranches(client, owner, repoName, fullPr.head.ref, deploymentBranches)
                : Promise.resolve([]),
              fetchUnresolvedCommentCount(client, owner, repoName, item.number),
            ]);

            const taskData = mapPrToTaskData(fullPr, repo.id, approvedCount, checksResult, onDeploymentBranches, unresolvedCount);
            return upsertPrTask(taskData);
          })
        );

        for (const result of results) {
          if (result === "new") newCount++;
          else if (result === "updated") updatedCount++;
          else unchangedCount++;
          synced++;
        }
      }

      hasMore = data.items.length === 100;
      page++;
    }

    // Sync orphaned tasks (PRs that were merged or closed)
    const orphanedTasks = await db
      .select({
        prNumber: tasks.prNumber,
        repositoryId: tasks.repositoryId,
      })
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.prNumber),
          isNotNull(tasks.repositoryId)
        )
      )
      .then((rows) =>
        rows.filter(
          (r) => r.prNumber && r.repositoryId && !syncedPrs.has(`${r.repositoryId}:${r.prNumber}`)
        )
      );

    // Filter to valid orphaned tasks with matching repos
    const validOrphans = orphanedTasks
      .filter((task) => task.prNumber && task.repositoryId)
      .map((task) => {
        const repo = reposById.get(task.repositoryId!);
        return repo ? { task, repo } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Process orphans in batches
    const ORPHAN_BATCH_SIZE = 5;
    for (let i = 0; i < validOrphans.length; i += ORPHAN_BATCH_SIZE) {
      const batch = validOrphans.slice(i, i + ORPHAN_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ({ task, repo }) => {
          const { data: pr } = await client.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: task.prNumber!,
          });

          // Fetch approved review count, check runs, and unresolved comments in parallel
          const [approvedCount, checksResult, unresolvedCount] = await Promise.all([
            fetchApprovedReviewCount(client, repo.owner, repo.repo, task.prNumber!),
            pr.head?.sha
              ? fetchCheckRunsStatus(client, repo.owner, repo.repo, pr.head.sha)
              : Promise.resolve({ checksStatus: null, checksDetails: null }),
            fetchUnresolvedCommentCount(client, repo.owner, repo.repo, task.prNumber!),
          ]);

          // Orphaned PRs are closed/merged, clear deployment branches
          const taskData = mapPrToTaskData(pr, repo.id, approvedCount, checksResult, [], unresolvedCount);
          return upsertPrTask(taskData);
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value === "new") newCount++;
          else if (result.value === "updated") updatedCount++;
          else unchangedCount++;
          synced++;
        }
        // Rejected results are skipped (PR may be deleted or inaccessible)
      }
    }
  } catch (err: unknown) {
    if (err instanceof GitHubConfigError) {
      throw err;
    }

    if (isApiError(err)) {
      if (err.status === 401) {
        throw new GitHubApiError(
          "GitHub authentication failed. Check your GITHUB_TOKEN.",
          "GITHUB_AUTH_FAILED"
        );
      }
      if (err.status === 403) {
        throw new GitHubApiError(
          "GitHub rate limit exceeded or insufficient permissions.",
          "GITHUB_FORBIDDEN"
        );
      }
      if (err.status === 422) {
        throw new GitHubApiError(
          "Invalid search query. Check github_username setting.",
          "GITHUB_INVALID_QUERY"
        );
      }

      throw new GitHubApiError(
        err.message || "Failed to fetch PRs from GitHub",
        "GITHUB_API_ERROR"
      );
    }

    throw new GitHubApiError("Failed to fetch PRs from GitHub", "GITHUB_API_ERROR");
  }

  // Log sync completion
  const parts: string[] = [];
  if (unchangedCount > 0) parts.push(`${unchangedCount} unchanged`);
  if (newCount > 0) parts.push(`${newCount} new`);
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  const summary = parts.length > 0 ? parts.join(", ") : "no changes";

  await db.insert(logs).values({
    taskId: null,
    content: `GitHub sync completed: ${summary}`,
    source: "github",
    createdAt: now(),
  });

  return { synced, new: newCount, updated: updatedCount, unchanged: unchangedCount };
}

export async function syncGitHubPullRequestByNumber(
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ status: "new" | "updated" | "unchanged" }> {
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

    // Parse deployment branches for this repo
    const deploymentBranches: string[] = repository.deploymentBranches
      ? JSON.parse(repository.deploymentBranches)
      : [];

    // Detect deployment branches only for open PRs
    const isOpen = pr.state === "open" && !pr.merged;

    // Fetch approved review count, check runs, deployment branches, and unresolved comments in parallel
    const [approvedCount, checksResult, onDeploymentBranches, unresolvedCount] = await Promise.all([
      fetchApprovedReviewCount(client, owner, repo, prNumber),
      pr.head?.sha
        ? fetchCheckRunsStatus(client, owner, repo, pr.head.sha)
        : Promise.resolve({ checksStatus: null, checksDetails: null }),
      isOpen && pr.head?.ref && deploymentBranches.length > 0
        ? detectDeploymentBranches(client, owner, repo, pr.head.ref, deploymentBranches)
        : Promise.resolve([]),
      fetchUnresolvedCommentCount(client, owner, repo, prNumber),
    ]);

    const taskData = mapPrToTaskData(pr, repository.id, approvedCount, checksResult, onDeploymentBranches, unresolvedCount);
    const status = await upsertPrTask(taskData);
    return { status };
  } catch (err: unknown) {
    if (err instanceof GitHubConfigError) {
      throw err;
    }

    if (isApiError(err)) {
      if (err.status === 401) {
        throw new GitHubApiError(
          "GitHub authentication failed. Check your GITHUB_TOKEN.",
          "GITHUB_AUTH_FAILED"
        );
      }
      if (err.status === 404) {
        throw new GitHubApiError(
          `PR #${prNumber} not found in ${owner}/${repo}`,
          "GITHUB_PR_NOT_FOUND"
        );
      }

      throw new GitHubApiError(
        err.message || `Failed to fetch PR #${prNumber} from GitHub`,
        "GITHUB_API_ERROR"
      );
    }

    throw new GitHubApiError(`Failed to fetch PR #${prNumber} from GitHub`, "GITHUB_API_ERROR");
  }
}
