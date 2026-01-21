import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories, logs } from "../../db/schema";
import { getGitHubClient, getGitHubConfig, GitHubConfigError } from "../lib/github-client";
import { now } from "../lib/timestamp";
import { generateTaskDiff, formatDiffLog } from "../lib/diff";

const GITHUB_TRACKED_FIELDS = [
  "prState",
  "prAuthor",
  "headBranch",
  "baseBranch",
  "isDraft",
  "checksStatus",
  "approvedReviewCount",
  "unresolvedCommentCount",
] as const;

const LARGE_FIELDS = ["checksDetails"] as const;

function formatPrCreatedLog(isDraft: number, prState: string, prNumber: number, headBranch: string): string {
  const draftStatus = isDraft ? "Draft" : "Ready";
  return `# Task created\n${draftStatus} - ${prState} - #${prNumber} - ${headBranch}`;
}

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
  unresolvedCommentCount: number;
  prSyncedAt: string;
  updatedAt: string;
  onDeploymentBranches: string | null;
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
  checksResult: ChecksResult = { checksStatus: null, checksDetails: null },
  onDeploymentBranches: string[] = [],
  unresolvedCommentCount = 0
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
    unresolvedCommentCount,
    prSyncedAt: timestamp,
    updatedAt: timestamp,
    onDeploymentBranches: onDeploymentBranches.length > 0 ? JSON.stringify(onDeploymentBranches) : null,
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

interface GraphQLReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{ isResolved: boolean }>;
      };
    };
  };
}

async function fetchUnresolvedCommentCount(
  client: ReturnType<typeof getGitHubClient>,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number> {
  const query = `
    query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
            }
          }
        }
      }
    }
  `;
  try {
    const result = await client.graphql<GraphQLReviewThreadsResponse>(query, { owner, repo, prNumber });
    return result.repository.pullRequest.reviewThreads.nodes.filter((t) => !t.isResolved).length;
  } catch {
    return 0;
  }
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

    // Fetch both check runs (GitHub Actions, etc.) and commit statuses (Buildkite, etc.) in parallel
    const [checkRunsResponse, statusResponse] = await Promise.race([
      Promise.all([
        client.checks.listForRef({ owner, repo, ref: headSha }),
        client.repos.getCombinedStatusForRef({ owner, repo, ref: headSha }),
      ]),
      timeoutPromise,
    ]);

    const checkRuns = checkRunsResponse.data.check_runs;
    const statuses = statusResponse.data.statuses;

    if (checkRuns.length === 0 && statuses.length === 0) {
      return { checksStatus: null, checksDetails: null };
    }

    // Deduplicate check runs by name - keep only the latest run for each unique check
    // GitHub returns all iterations including reruns, we want only the most recent
    const latestByName = new Map<string, typeof checkRuns[0]>();
    for (const run of checkRuns) {
      const existing = latestByName.get(run.name);
      if (!existing || new Date(run.started_at || 0) > new Date(existing.started_at || 0)) {
        latestByName.set(run.name, run);
      }
    }
    const uniqueRuns = Array.from(latestByName.values());

    // Convert check runs to CheckDetail format
    const checkRunDetails: CheckDetail[] = uniqueRuns.map((run) => ({
      name: run.name,
      status: run.status as "queued" | "in_progress" | "completed",
      conclusion: run.conclusion,
      url: run.html_url,
    }));

    // Convert commit statuses to CheckDetail format
    // Status API uses state: "error" | "failure" | "pending" | "success"
    const statusDetails: CheckDetail[] = statuses.map((status) => ({
      name: status.context,
      status: status.state === "pending" ? "in_progress" : "completed",
      conclusion: status.state === "success" ? "success" : status.state === "pending" ? null : "failure",
      url: status.target_url,
    }));

    // Merge and dedupe - check runs take precedence over statuses with same name
    const allDetails = new Map<string, CheckDetail>();
    for (const detail of statusDetails) {
      allDetails.set(detail.name, detail);
    }
    for (const detail of checkRunDetails) {
      allDetails.set(detail.name, detail);
    }
    const details = Array.from(allDetails.values());

    // Aggregate status:
    // - "failed" if any check has conclusion === "failure" | "timed_out"
    // - "pending" if any check has status !== "completed"
    // - "passed" if all checks have conclusion === "success" | "skipped" | "neutral"
    let checksStatus: string;

    const hasFailed = details.some(
      (d) => d.conclusion === "failure" || d.conclusion === "timed_out"
    );
    const hasPending = details.some(
      (d) => d.status !== "completed"
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

async function detectDeploymentBranches(
  client: ReturnType<typeof getGitHubClient>,
  owner: string,
  repo: string,
  headBranch: string,
  deploymentBranches: string[]
): Promise<string[]> {
  if (deploymentBranches.length === 0) return [];

  const onBranches: string[] = [];

  for (const branch of deploymentBranches) {
    try {
      // Compare deployment branch against PR head branch
      // ahead_by = commits in PR branch not in deployment branch
      // If ahead_by === 0, the deployment branch contains all PR commits
      const { data: comparison } = await client.repos.compareCommits({
        owner,
        repo,
        base: branch,
        head: headBranch,
      });

      if (comparison.ahead_by === 0) {
        onBranches.push(branch);
      }
    } catch {
      // Branch may not exist or be inaccessible, skip
    }
  }

  return onBranches;
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
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.prNumber, data.prNumber)
      )
    );

  if (existingByNumber.length > 0) {
    const oldTask = existingByNumber[0];

    // Compare fields and generate diff
    const diffs = generateTaskDiff(
      oldTask as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      GITHUB_TRACKED_FIELDS
    );

    // Update existing, preserve Jira fields if already merged
    await db
      .update(tasks)
      .set({
        title: oldTask.jiraKey ? undefined : data.title, // Keep Jira title if merged
        prState: data.prState,
        prAuthor: data.prAuthor,
        headBranch: data.headBranch,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        checksDetails: data.checksDetails,
        reviewStatus: data.reviewStatus,
        approvedReviewCount: data.approvedReviewCount,
        unresolvedCommentCount: data.unresolvedCommentCount,
        onDeploymentBranches: data.onDeploymentBranches,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, oldTask.id));

    // Only log if there were actual changes
    if (diffs.length > 0) {
      const timestamp = now();
      await db.insert(logs).values({
        taskId: oldTask.id,
        content: formatDiffLog(diffs, LARGE_FIELDS),
        source: "github",
        createdAt: timestamp,
      });
    }

    return "updated";
  }

  // Next, try to find by repositoryId + headBranch (local entry waiting for sync)
  const existingByBranch = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.headBranch, data.headBranch)
      )
    );

  if (existingByBranch.length > 0) {
    const oldTask = existingByBranch[0];

    // Compare fields and generate diff
    const diffs = generateTaskDiff(
      oldTask as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      GITHUB_TRACKED_FIELDS
    );

    // Update existing local entry with GitHub data, preserve Jira fields
    await db
      .update(tasks)
      .set({
        prNumber: data.prNumber,
        title: oldTask.jiraKey ? undefined : data.title, // Keep Jira title if merged
        prState: data.prState,
        prAuthor: data.prAuthor,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        checksDetails: data.checksDetails,
        reviewStatus: data.reviewStatus,
        approvedReviewCount: data.approvedReviewCount,
        unresolvedCommentCount: data.unresolvedCommentCount,
        onDeploymentBranches: data.onDeploymentBranches,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, oldTask.id));

    // Only log if there were actual changes
    if (diffs.length > 0) {
      const timestamp = now();
      await db.insert(logs).values({
        taskId: oldTask.id,
        content: formatDiffLog(diffs, LARGE_FIELDS),
        source: "github",
        createdAt: timestamp,
      });
    }

    return "updated";
  }

  // No existing entry, create new PR-only task (orphaned)
  const timestamp = now();
  const result = await db
    .insert(tasks)
    .values({
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
      unresolvedCommentCount: data.unresolvedCommentCount,
      onDeploymentBranches: data.onDeploymentBranches,
      prSyncedAt: data.prSyncedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning({ id: tasks.id });

  // Log new task creation
  await db.insert(logs).values({
    taskId: result[0].id,
    content: formatPrCreatedLog(data.isDraft, data.prState, data.prNumber, data.headBranch),
    source: "github",
    createdAt: timestamp,
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
  const syncedPrs = new Set<string>();

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
        const result = await upsertPrTask(taskData);
        if (result === "new") newCount++;
        else updatedCount++;
        synced++;
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

    for (const task of orphanedTasks) {
      if (!task.prNumber || !task.repositoryId) continue;
      const repo = repos.find((r) => r.id === task.repositoryId);
      if (!repo) continue;

      try {
        const { data: pr } = await client.pulls.get({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: task.prNumber,
        });

        // Fetch approved review count, check runs, and unresolved comments in parallel
        const [approvedCount, checksResult, unresolvedCount] = await Promise.all([
          fetchApprovedReviewCount(client, repo.owner, repo.repo, task.prNumber),
          pr.head?.sha
            ? fetchCheckRunsStatus(client, repo.owner, repo.repo, pr.head.sha)
            : Promise.resolve({ checksStatus: null, checksDetails: null }),
          fetchUnresolvedCommentCount(client, repo.owner, repo.repo, task.prNumber),
        ]);

        // Orphaned PRs are closed/merged, clear deployment branches
        const taskData = mapPrToTaskData(pr, repo.id, approvedCount, checksResult, [], unresolvedCount);
        const result = await upsertPrTask(taskData);
        if (result === "new") newCount++;
        else updatedCount++;
        synced++;
      } catch {
        // PR may be deleted or inaccessible, skip
      }
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
