import { eq, and, or, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { getGitHubClient, getGitHubConfig, GitHubConfigError } from "../lib/github-client";
import { mapGqlPrToTaskData } from "./github-mappers";
import { fetchDeployedVersions } from "./github-fetchers";
import {
  fetchPullRequests,
  fetchPullRequestCore,
  fetchPullRequestChecks,
  fetchContainment,
  mapChecks,
  prKey,
  type PrTarget,
  type ContainmentRequest,
  type ContainmentTarget,
  type GqlPrCore,
} from "./github-graphql";
import { upsertPrTask } from "./github-upsert";
import { isApiError } from "../lib/errors";
import type { SyncResult } from "../lib/types";

export type { SyncResult };

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/** Deployment branches configured for a repo. */
function deploymentBranchesOf(repo: { deploymentBranches: string | null }): string[] {
  return repo.deploymentBranches ? JSON.parse(repo.deploymentBranches) : [];
}

/**
 * Branches whose "merged in <branch>" label is present. Labels are checked in
 * addition to commit containment because rebasing an env branch after a merge
 * rewrites SHAs, which makes commit-based detection report a false negative.
 */
function labelDetectedBranches(pr: GqlPrCore, deploymentBranches: string[]): string[] {
  return deploymentBranches.filter((branch) => pr.labels.includes(`merged in ${branch}`));
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
    // Search API: fetch only open PRs authored by user in configured repos.
    // Deployed versions are scraped over HTTP, so they're fetched concurrently.
    const query = `is:pr is:open author:${config.username} ${repoFilters}`;

    const collectOpenPrs = async () => {
      const found: Array<{ repo: typeof repos[number]; number: number }> = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const { data } = await client.request("GET /search/issues", { q: query, per_page: 100, page });
        for (const item of data.items) {
          const match = (item.repository_url || "").match(/repos\/([^/]+)\/([^/]+)$/);
          if (!match) continue;
          const repo = reposByKey.get(`${match[1]}/${match[2]}`);
          if (repo) found.push({ repo, number: item.number });
        }
        hasMore = data.items.length === 100;
        page++;
      }
      return found;
    };

    const collectDeployedVersions = async () => {
      const byRepo = new Map<number, Map<string, string>>();
      await Promise.all(
        repos
          .filter((r) => r.deploymentUrls)
          .map(async (r) => {
            const urls = JSON.parse(r.deploymentUrls!) as Record<string, string>;
            const versions = await fetchDeployedVersions(urls);
            if (versions.size > 0) byRepo.set(r.id, versions);
          })
      );
      return byRepo;
    };

    const [openPrs, deployedVersionsByRepo] = await Promise.all([
      collectOpenPrs(),
      collectDeployedVersions(),
    ]);

    for (const { repo, number } of openPrs) {
      syncedPrs.add(`${repo.id}:${number}`);
    }

    // Orphans: tasks whose PR is no longer open, so the search didn't return it.
    // They're fetched in the same batch as the open PRs — just extra numbers.
    const orphans = (
      await db
        .select({ prNumber: tasks.prNumber, repositoryId: tasks.repositoryId })
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.prNumber),
            isNotNull(tasks.repositoryId),
            or(eq(tasks.prState, "open"), isNull(tasks.prState))
          )
        )
    )
      .filter((r) => r.prNumber && r.repositoryId && !syncedPrs.has(`${r.repositoryId}:${r.prNumber}`))
      .map((r) => {
        const repo = reposById.get(r.repositoryId!);
        return repo ? { repo, number: r.prNumber! } : null;
      })
      .filter((x): x is { repo: typeof repos[number]; number: number } => x !== null);

    const allPrs = [...openPrs, ...orphans];
    if (allPrs.length === 0) {
      return { synced: 0, new: 0, updated: 0, unchanged: 0 };
    }

    const prTargets: PrTarget[] = allPrs.map(({ repo, number }) => ({
      owner: repo.owner,
      repo: repo.repo,
      number,
    }));

    // Containment needs only `headRefName`, which comes from the cheap core
    // query — so it runs concurrently with the much slower check-suite fetch
    // rather than after it.
    const prData = await fetchPullRequestCore(client, prTargets);

    // Containment only applies to open PRs — a merged or closed PR has its
    // deployment badges cleared.
    const containmentRequests: ContainmentRequest[] = [];
    for (const { repo, number } of allPrs) {
      const pr = prData.get(prKey(repo.owner, repo.repo, number));
      if (!pr || pr.state !== "OPEN" || !pr.headRefName) continue;

      const deployedVersions = deployedVersionsByRepo.get(repo.id) ?? new Map<string, string>();
      const containmentTargets: ContainmentTarget[] = [
        ...deploymentBranchesOf(repo).map((b) => ({ label: b, ref: b, kind: "branch" as const })),
        ...[...deployedVersions.entries()].map(([label, sha]) => ({ label, ref: sha, kind: "deployed" as const })),
      ];
      if (containmentTargets.length === 0) continue;

      containmentRequests.push({
        owner: repo.owner,
        repo: repo.repo,
        number,
        headRefName: pr.headRefName,
        targets: containmentTargets,
      });
    }

    const [checksData, containment] = await Promise.all([
      fetchPullRequestChecks(client, prTargets),
      fetchContainment(client, containmentRequests),
    ]);

    for (const { repo, number } of allPrs) {
      const key = prKey(repo.owner, repo.repo, number);
      const pr = prData.get(key);
      // PR may have been deleted or become inaccessible — skip, as before.
      if (!pr) continue;

      const isOpen = pr.state === "OPEN";
      const deploymentBranches = deploymentBranchesOf(repo);
      const merged = containment.get(key);

      const taskData = mapGqlPrToTaskData(
        pr,
        repo.id,
        mapChecks(checksData.get(key)),
        merged?.onBranches ?? [],
        merged?.deployedOn ?? [],
        isOpen ? labelDetectedBranches(pr, deploymentBranches) : []
      );

      const result = await upsertPrTask(taskData);
      if (result === "new") newCount++;
      else if (result === "updated") updatedCount++;
      else unchangedCount++;
      synced++;
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

  return { synced, new: newCount, updated: updatedCount, unchanged: unchangedCount };
}

export async function fetchPrTaskData(
  owner: string,
  repo: string,
  prNumber: number
) {
  const client = getGitHubClient();

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
    const [prData, deployedVersions] = await Promise.all([
      fetchPullRequests(client, [{ owner, repo, number: prNumber }]),
      repository.deploymentUrls
        ? fetchDeployedVersions(JSON.parse(repository.deploymentUrls) as Record<string, string>)
        : Promise.resolve(new Map<string, string>()),
    ]);

    const pr = prData.get(prKey(owner, repo, prNumber));
    if (!pr) {
      throw new GitHubApiError(`PR #${prNumber} not found in ${owner}/${repo}`, "GITHUB_PR_NOT_FOUND");
    }

    const isOpen = pr.state === "OPEN";
    const deploymentBranches = deploymentBranchesOf(repository);

    const containmentTargets: ContainmentTarget[] = isOpen
      ? [
          ...deploymentBranches.map((b) => ({ label: b, ref: b, kind: "branch" as const })),
          ...[...deployedVersions.entries()].map(([label, sha]) => ({ label, ref: sha, kind: "deployed" as const })),
        ]
      : [];

    const containment =
      containmentTargets.length > 0 && pr.headRefName
        ? (
            await fetchContainment(client, [
              { owner, repo, number: prNumber, headRefName: pr.headRefName, targets: containmentTargets },
            ])
          ).get(prKey(owner, repo, prNumber))
        : undefined;

    return mapGqlPrToTaskData(
      pr,
      repository.id,
      mapChecks(pr),
      containment?.onBranches ?? [],
      containment?.deployedOn ?? [],
      isOpen ? labelDetectedBranches(pr, deploymentBranches) : []
    );
  } catch (err: unknown) {
    if (err instanceof GitHubConfigError) {
      throw err;
    }

    // Already classified (e.g. the not-found thrown above). GraphQL returns a
    // null node rather than a 404, so that case never reaches isApiError.
    if (err instanceof GitHubApiError) {
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

export async function syncGitHubPullRequestByNumber(
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ status: "new" | "updated" | "unchanged" }> {
  const taskData = await fetchPrTaskData(owner, repo, prNumber);
  const status = await upsertPrTask(taskData);
  return { status };
}
