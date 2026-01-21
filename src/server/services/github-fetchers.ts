import { getGitHubClient } from "../lib/github-client";
import type { ChecksResult } from "./github-mappers";

type GitHubClient = ReturnType<typeof getGitHubClient>;

interface CheckDetail {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  url: string | null;
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

export async function fetchApprovedReviewCount(
  client: GitHubClient,
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

export async function fetchUnresolvedCommentCount(
  client: GitHubClient,
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

export async function fetchCheckRunsStatus(
  client: GitHubClient,
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

export async function detectDeploymentBranches(
  client: GitHubClient,
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
