/**
 * Pulls PRs from GitHub into tasks: the open PRs the user authored or is
 * assigned to (a bot's PR) in enabled repositories, plus those of tasks still
 * open here (merged or closed since, or someone else's). A single PR goes
 * through the same batched fetch.
 */
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { getGitHubClient, getGitHubConfig, GitHubError, toGitHubError } from "../lib/github-client";
import { httpStatusOf } from "../lib/errors";
import { findRepository } from "../lib/queries";
import { parseStringList } from "@/shared/json";
import { parseJson } from "@/shared/json";
import { mapGqlPrToTaskData, type PrTaskData } from "./github-mappers";
import {
  fetchContainment,
  fetchPullRequestChecks,
  fetchPullRequestCore,
  mapChecks,
  prKey,
  type ContainmentRequest,
  type GqlPrCore,
} from "./github-graphql";
import { upsertPrTask } from "./github-upsert";
import type { SyncResult } from "@/shared/types";

type RepoRow = typeof repositories.$inferSelect;
type GitHubClient = ReturnType<typeof getGitHubClient>;

/** A PR to fetch: its configured repository and its number. */
interface PrRef {
  repo: RepoRow;
  number: number;
}

const keyOf = ({ repo, number }: PrRef) => prKey(repo.owner, repo.repo, number);

/** The SHA each deployment environment serves, probed over plain HTTP. */
async function fetchDeployedVersions(deploymentUrls: Record<string, string>): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  await Promise.allSettled(
    Object.entries(deploymentUrls).map(async ([branch, url]) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { method: "HEAD", signal: controller.signal });
        // Prefer full 40-char SHA from the link header's static asset URL
        // (e.g. https://static.hvbrt.com/v-<sha>/...) — GitHub's compare API
        // rejects abbreviated SHAs.
        const linkHeader = res.headers.get("link");
        const fullSha = linkHeader?.match(/\/v-([a-f0-9]{40})\//)?.[1];
        if (fullSha) {
          result.set(branch, fullSha);
        } else {
          const version = res.headers.get("x-app-version");
          const shortSha = version?.match(/-([a-f0-9]{7,40})\.\w+$/)?.[1];
          if (shortSha) result.set(branch, shortSha);
        }
      } catch {
        // Skip on error
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return result;
}

/** Deployed SHAs per environment, by repository id. */
async function deployedVersionsByRepo(repos: RepoRow[]): Promise<Map<number, Map<string, string>>> {
  const byRepo = new Map<number, Map<string, string>>();
  await Promise.all(
    repos.map(async (repo) => {
      const urls = parseJson<Record<string, string>>(repo.deploymentUrls, {});
      if (Object.keys(urls).length > 0) byRepo.set(repo.id, await fetchDeployedVersions(urls));
    })
  );
  return byRepo;
}

/**
 * Branches whose "merged in <branch>" label is present. Labels are checked in
 * addition to commit containment because rebasing an env branch after a merge
 * rewrites SHAs, which makes commit-based detection report a false negative.
 */
function labelDetectedBranches(pr: GqlPrCore, deploymentBranches: string[]): string[] {
  return deploymentBranches.filter((branch) => pr.labels.includes(`merged in ${branch}`));
}

/**
 * What an open PR's branch is tested against: its repository's deployment
 * branches and deployed SHAs. A merged or closed PR gets none, which clears
 * its deployment badges.
 */
function containmentRequest(pr: GqlPrCore, { repo, number }: PrRef, deployed: Map<string, string> = new Map()) {
  if (pr.state !== "OPEN" || !pr.headRefName) return null;
  const targets = [
    ...parseStringList(repo.deploymentBranches).map((b) => ({ label: b, ref: b, kind: "branch" as const })),
    ...[...deployed].map(([label, sha]) => ({ label, ref: sha, kind: "deployed" as const })),
  ];
  if (targets.length === 0) return null;
  return { owner: repo.owner, repo: repo.repo, number, headRefName: pr.headRefName, targets } satisfies ContainmentRequest;
}

/**
 * PRs as task data, batched: the core fields first, then the checks alongside
 * the containment test (it needs only the core's `headRefName`, so it doesn't
 * wait on the much slower check-suite fetch). PRs GitHub didn't return
 * (deleted, inaccessible) are left out.
 */
async function fetchPrs(client: GitHubClient, prs: PrRef[]): Promise<Map<string, PrTaskData>> {
  const targets = prs.map(({ repo, number }) => ({ owner: repo.owner, repo: repo.repo, number }));
  const repos = [...new Map(prs.map(({ repo }) => [repo.id, repo])).values()];
  const [core, deployed] = await Promise.all([fetchPullRequestCore(client, targets), deployedVersionsByRepo(repos)]);
  const requests = prs.flatMap((ref) => {
    const pr = core.get(keyOf(ref));
    const request = pr && containmentRequest(pr, ref, deployed.get(ref.repo.id));
    return request ? [request] : [];
  });
  const [checks, containment] = await Promise.all([
    fetchPullRequestChecks(client, targets),
    fetchContainment(client, requests),
  ]);

  const result = new Map<string, PrTaskData>();
  for (const ref of prs) {
    const key = keyOf(ref);
    const pr = core.get(key);
    if (!pr) continue;
    const contained = containment.get(key);
    const labelled = pr.state === "OPEN" ? labelDetectedBranches(pr, parseStringList(ref.repo.deploymentBranches)) : [];
    result.set(
      key,
      mapGqlPrToTaskData(pr, ref.repo.id, mapChecks(checks.get(key)), contained?.onBranches ?? [], contained?.deployedOn ?? [], labelled)
    );
  }
  return result;
}

/** The open PRs in these repositories the user authored or is assigned to (bots open PRs for them), from the search API. */
async function searchOpenPrs(client: GitHubClient, username: string, repos: RepoRow[]): Promise<PrRef[]> {
  const byName = new Map(repos.map((r) => [`${r.owner}/${r.repo}`, r]));
  const repoFilter = repos.map((r) => `repo:${r.owner}/${r.repo}`).join(" ");
  const found: PrRef[] = [];
  for (const role of ["author", "assignee"]) {
    const q = `is:pr is:open ${role}:${username} ${repoFilter}`;
    for (let page = 1; ; page++) {
      const { data } = await client.request("GET /search/issues", { q, per_page: 100, page });
      for (const item of data.items) {
        const match = (item.repository_url || "").match(/repos\/([^/]+)\/([^/]+)$/);
        const repo = match ? byName.get(`${match[1]}/${match[2]}`) : undefined;
        if (repo) found.push({ repo, number: item.number });
      }
      if (data.items.length < 100) break;
    }
  }
  return found;
}

/** The PRs of tasks still open here, in these repositories: the search misses them once merged or closed, and someone else's. */
async function trackedOpenPrs(repos: RepoRow[]): Promise<PrRef[]> {
  const byId = new Map(repos.map((r) => [r.id, r]));
  const rows = await db
    .select({ prNumber: tasks.prNumber, repositoryId: tasks.repositoryId })
    .from(tasks)
    .where(and(isNotNull(tasks.prNumber), or(eq(tasks.prState, "open"), isNull(tasks.prState))));
  return rows.flatMap(({ prNumber, repositoryId }) => {
    const repo = repositoryId === null ? undefined : byId.get(repositoryId);
    return repo && prNumber ? [{ repo, number: prNumber }] : [];
  });
}

export async function syncGitHubPullRequests(): Promise<SyncResult> {
  const { username } = await getGitHubConfig();
  const client = getGitHubClient();
  const repos = await db.select().from(repositories).where(eq(repositories.enabled, 1));
  const result: SyncResult = { synced: 0, new: 0, updated: 0, unchanged: 0 };
  if (repos.length === 0) return result;

  let prs: Map<string, PrTaskData>;
  try {
    const refs = [...(await searchOpenPrs(client, username, repos)), ...(await trackedOpenPrs(repos))];
    // A PR several tasks hold (one per ticket) is fetched once.
    prs = await fetchPrs(client, [...new Map(refs.map((ref) => [keyOf(ref), ref])).values()]);
  } catch (err) {
    // The search answers 422 when github_username names no GitHub user.
    if (httpStatusOf(err) === 422) {
      throw new GitHubError("Invalid search query. Check the github_username setting.", 400, "GITHUB_INVALID_QUERY");
    }
    throw toGitHubError(err, "Failed to fetch PRs from GitHub");
  }

  // One PR failing (e.g. a task merged away by a concurrent sync) doesn't stop the others.
  for (const data of prs.values()) {
    try {
      if ((await upsertPrTask(data)) === "new") result.new++;
      else result.updated++;
      result.synced++;
    } catch (err) {
      console.error(`[github-sync] ${data.repositoryId}#${data.prNumber} failed`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}

/** One PR as task data, fetched like the sync's. Its repository must be configured. */
export async function fetchPrTaskData(owner: string, repo: string, prNumber: number): Promise<PrTaskData> {
  const repository = await findRepository(owner, repo);
  if (!repository) {
    throw new GitHubError(`Repository ${owner}/${repo} not configured`, 400, "GITHUB_REPO_NOT_CONFIGURED");
  }
  const notFound = `PR #${prNumber} not found in ${owner}/${repo}`;
  const ref = { repo: repository, number: prNumber };
  let data: PrTaskData | undefined;
  try {
    data = (await fetchPrs(getGitHubClient(), [ref])).get(keyOf(ref));
  } catch (err) {
    throw toGitHubError(err, `Failed to fetch PR #${prNumber} from GitHub`, notFound);
  }
  // GraphQL answers a missing PR with a null node, not a 404.
  if (!data) throw new GitHubError(notFound, 404, "GITHUB_PR_NOT_FOUND");
  return data;
}

/** Newest PR (any state) opened from `branch` in owner/repo, or null when there is none. */
export async function findPrNumberByBranch(owner: string, repo: string, branch: string): Promise<number | null> {
  try {
    const { data } = await getGitHubClient().rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: "all",
      per_page: 1,
    });
    return data[0]?.number ?? null;
  } catch (err) {
    throw toGitHubError(err, `Failed to look up the PR for ${branch}`);
  }
}
