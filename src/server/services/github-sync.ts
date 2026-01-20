import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
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

interface CheckDetail {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  url: string | null;
}

interface ChecksResult {
  checksStatus: string | null;
  checksDetails: string | null;
}

interface PrTaskData {
  prNumber: number;
  repositoryId: number;
  title: string;
  prState: string;
  prAuthor: string | null;
  headBranch: string;
  baseBranch: string | null;
  isDraft: number;
  checksStatus: string | null;
  checksDetails: string | null;
  reviewStatus: string | null;
  approvedReviewCount: number;
  prSyncedAt: string;
  updatedAt: string;
}

function mapPrToTaskData(
  pr: {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    merged?: boolean;
    user?: { login?: string } | null;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
  },
  repositoryId: number,
  approvedReviewCount = 0,
  checksResult: ChecksResult = { checksStatus: null, checksDetails: null }
): PrTaskData {
  // Map state: GitHub has open/closed + merged boolean, we use open/closed/merged
  const prState = pr.merged ? "merged" : pr.state;
  const timestamp = now();

  return {
    prNumber: pr.number,
    repositoryId,
    title: pr.title,
    prState,
    prAuthor: pr.user?.login || null,
    headBranch: pr.head?.ref || "",
    baseBranch: pr.base?.ref || null,
    isDraft: pr.draft ? 1 : 0,
    checksStatus: checksResult.checksStatus,
    checksDetails: checksResult.checksDetails,
    reviewStatus: null, // Requires separate API call, skip for v1
    approvedReviewCount,
    prSyncedAt: timestamp,
    updatedAt: timestamp,
  };
}

async function fetchApprovedReviewCount(
  client: ReturnType<typeof getGitHubClient>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number> {
  const { data: reviews } = await client.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });
  // Count unique users who approved (latest review per user)
  const latestByUser = new Map<string, string>();
  for (const r of reviews) {
    if (r.user?.login) latestByUser.set(r.user.login, r.state || "");
  }
  return [...latestByUser.values()].filter((s) => s === "APPROVED").length;
}

async function fetchCheckRunsStatus(
  client: ReturnType<typeof getGitHubClient>,
  owner: string,
  repo: string,
  headSha: string
): Promise<ChecksResult> {
  try {
    // Add 5s timeout to prevent blocking the whole sync
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Checks fetch timeout")), 5000)
    );

    const { data } = await Promise.race([
      client.checks.listForRef({
        owner,
        repo,
        ref: headSha,
      }),
      timeoutPromise,
    ]);

    if (data.check_runs.length === 0) {
      return { checksStatus: null, checksDetails: null };
    }

    // Deduplicate by check name - keep only the latest run for each unique check
    // GitHub returns all iterations including reruns, we want only the most recent
    const latestByName = new Map<string, typeof data.check_runs[0]>();
    for (const run of data.check_runs) {
      const existing = latestByName.get(run.name);
      if (!existing || new Date(run.started_at || 0) > new Date(existing.started_at || 0)) {
        latestByName.set(run.name, run);
      }
    }
    const uniqueRuns = Array.from(latestByName.values());

    const details: CheckDetail[] = uniqueRuns.map((run) => ({
      name: run.name,
      status: run.status as "queued" | "in_progress" | "completed",
      conclusion: run.conclusion,
      url: run.html_url,
    }));

    // Aggregate status:
    // - "failed" if any check has conclusion === "failure" | "timed_out"
    // - "pending" if any check has status !== "completed"
    // - "passed" if all checks have conclusion === "success" | "skipped" | "neutral"
    let checksStatus: string;

    const hasFailed = uniqueRuns.some(
      (run) => run.conclusion === "failure" || run.conclusion === "timed_out"
    );
    const hasPending = uniqueRuns.some(
      (run) => run.status !== "completed"
    );

    if (hasFailed) {
      checksStatus = "failed";
    } else if (hasPending) {
      checksStatus = "pending";
    } else {
      checksStatus = "passed";
    }

    return {
      checksStatus,
      checksDetails: JSON.stringify(details),
    };
  } catch {
    // If checks API fails, return null (non-critical)
    return { checksStatus: null, checksDetails: null };
  }
}

// Map PR state to task status
function mapPrStateToTaskStatus(prState: string, isDraft: number): string {
  if (prState === "merged") return "done";
  if (prState === "closed") return "done";
  if (isDraft) return "in_progress";
  return "code_review"; // Open PR = code review
}

async function upsertPrTask(data: PrTaskData): Promise<"new" | "updated"> {
  // First, try to find by repositoryId + prNumber (if we already synced this PR)
  const existingByNumber = await db
    .select({ id: tasks.id, jiraKey: tasks.jiraKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.prNumber, data.prNumber)
      )
    );

  if (existingByNumber.length > 0) {
    // Update existing, preserve Jira fields if already merged
    await db
      .update(tasks)
      .set({
        title: existingByNumber[0].jiraKey ? undefined : data.title, // Keep Jira title if merged
        prState: data.prState,
        prAuthor: data.prAuthor,
        headBranch: data.headBranch,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        checksDetails: data.checksDetails,
        reviewStatus: data.reviewStatus,
        approvedReviewCount: data.approvedReviewCount,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, existingByNumber[0].id));
    return "updated";
  }

  // Next, try to find by repositoryId + headBranch (local entry waiting for sync)
  const existingByBranch = await db
    .select({ id: tasks.id, jiraKey: tasks.jiraKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.headBranch, data.headBranch)
      )
    );

  if (existingByBranch.length > 0) {
    // Update existing local entry with GitHub data, preserve Jira fields
    await db
      .update(tasks)
      .set({
        prNumber: data.prNumber,
        title: existingByBranch[0].jiraKey ? undefined : data.title, // Keep Jira title if merged
        prState: data.prState,
        prAuthor: data.prAuthor,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        checksDetails: data.checksDetails,
        reviewStatus: data.reviewStatus,
        approvedReviewCount: data.approvedReviewCount,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, existingByBranch[0].id));
    return "updated";
  }

  // No existing entry, create new PR-only task (orphaned)
  const timestamp = now();
  await db.insert(tasks).values({
    title: data.title,
    description: null,
    status: mapPrStateToTaskStatus(data.prState, data.isDraft),
    prNumber: data.prNumber,
    repositoryId: data.repositoryId,
    headBranch: data.headBranch,
    baseBranch: data.baseBranch,
    prState: data.prState,
    prAuthor: data.prAuthor,
    isDraft: data.isDraft,
    checksStatus: data.checksStatus,
    checksDetails: data.checksDetails,
    reviewStatus: data.reviewStatus,
    approvedReviewCount: data.approvedReviewCount,
    prSyncedAt: data.prSyncedAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return "new";
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

        // Fetch approved review count and check runs in parallel
        const [approvedCount, checksResult] = await Promise.all([
          fetchApprovedReviewCount(client, owner, repoName, item.number),
          fullPr.head?.sha
            ? fetchCheckRunsStatus(client, owner, repoName, fullPr.head.sha)
            : Promise.resolve({ checksStatus: null, checksDetails: null }),
        ]);

        const taskData = mapPrToTaskData(fullPr, repo.id, approvedCount, checksResult);
        const result = await upsertPrTask(taskData);
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

    // Fetch approved review count and check runs in parallel
    const [approvedCount, checksResult] = await Promise.all([
      fetchApprovedReviewCount(client, owner, repo, prNumber),
      pr.head?.sha
        ? fetchCheckRunsStatus(client, owner, repo, pr.head.sha)
        : Promise.resolve({ checksStatus: null, checksDetails: null }),
    ]);

    const taskData = mapPrToTaskData(pr, repository.id, approvedCount, checksResult);
    const status = await upsertPrTask(taskData);
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
