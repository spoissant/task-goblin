import { getGitHubClient } from "../lib/github-client";
import type { ChecksResult } from "./github-mappers";

type GitHubClient = ReturnType<typeof getGitHubClient>;

export interface PrTarget {
  owner: string;
  repo: string;
  number: number;
}

export interface GqlCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  databaseId: number | null;
}

export interface GqlStatusContext {
  context: string;
  state: string;
  targetUrl: string | null;
}

export interface GqlPrCore {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  author: { login?: string } | null;
  headRefName: string | null;
  headRefOid: string | null;
  baseRefName: string | null;
  labels: string[];
  approvedReviewCount: number;
  unresolvedCommentCount: number;
}

export interface GqlPrChecks {
  checkRuns: GqlCheckRun[];
  statusContexts: GqlStatusContext[];
}

/** Team-level review state on a PR, which is how CODEOWNERS ownership surfaces. */
export interface GqlPrTeamReviews {
  /**
   * GitHub's verdict on the PR's own review requirements: REVIEW_REQUIRED,
   * CHANGES_REQUESTED, APPROVED, or null when the base ref requires no reviews.
   * A team request only gates the merge when this says reviews are outstanding.
   */
  reviewDecision: string | null;
  /** Teams with a review request still open, flagged if CODEOWNERS opened it. */
  pendingTeams: Array<{ slug: string; asCodeOwner: boolean }>;
  /** Slugs of teams a submitted review was made on behalf of. */
  reviewedTeams: string[];
}

export type GqlPullRequest = GqlPrCore & GqlPrChecks;

/** Everything the review-requests board needs per PR beyond the search hit. */
export interface GqlPrReviewInfo {
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  /**
   * Oldest first, matching REST listReviews order. Includes the viewer's own
   * unsubmitted draft as PENDING — GitHub only exposes those to their author.
   */
  reviews: Array<{ authorLogin: string; state: string }>;
  files: Array<{ filename: string; additions: number; deletions: number }>;
}

/** Comparison targets for one PR: env branch names and/or deployed SHAs. */
export interface ContainmentTarget {
  label: string;
  /** Branch name or commit SHA to test containment against. */
  ref: string;
  kind: "branch" | "deployed";
}

export interface ContainmentRequest extends PrTarget {
  headRefName: string;
  targets: ContainmentTarget[];
}

export interface ContainmentResult {
  onBranches: string[];
  deployedOn: string[];
}

export const prKey = (owner: string, repo: string, number: number) => `${owner}/${repo}#${number}`;

/** GraphQL string literal. Branch names are interpolated into queries. */
const lit = (value: string) => JSON.stringify(value);

/**
 * A partial GraphQL failure (one inaccessible repo, one deleted PR) still
 * returns usable data for every other alias. Octokit throws on any `errors`
 * entry, so recover the payload rather than losing the whole batch.
 */
async function graphqlPartial<T>(client: GitHubClient, query: string): Promise<T | null> {
  try {
    return await client.graphql<T>(query);
  } catch (err: unknown) {
    const data = (err as { data?: T })?.data;
    return data ?? null;
  }
}

/** Group targets by repo, preserving order, so one alias covers one repo. */
function groupByRepo(targets: PrTarget[]): Array<{ owner: string; repo: string; numbers: number[] }> {
  const groups = new Map<string, { owner: string; repo: string; numbers: number[] }>();
  for (const t of targets) {
    const key = `${t.owner}/${t.repo}`;
    if (!groups.has(key)) groups.set(key, { owner: t.owner, repo: t.repo, numbers: [] });
    groups.get(key)!.numbers.push(t.number);
  }
  return [...groups.values()];
}

// Keeps a single query's cost bounded — GraphQL enforces node limits, and very
// large queries get slow enough to risk a gateway timeout.
const MAX_PRS_PER_QUERY = 25;
// Smaller queries resolve much faster than one big one (expanding check suites
// for 14 PRs takes ~2.3s in a single query vs ~1.1s split four ways), but
// unbounded fan-out risks GitHub's secondary rate limits. Deriving the chunk
// size from the item count caps concurrency without needing a limiter.
const MAX_PARALLEL_QUERIES = 6;
const MIN_PRS_PER_QUERY = 4;

/** Split into chunks sized so at most MAX_PARALLEL_QUERIES run at once. */
function planChunks<T>(items: T[]): T[][] {
  const size = Math.min(
    MAX_PRS_PER_QUERY,
    Math.max(MIN_PRS_PER_QUERY, Math.ceil(items.length / MAX_PARALLEL_QUERIES))
  );
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run one query per chunk, all concurrently, merging results into one map. */
async function runChunked<T, V>(
  items: T[],
  worker: (chunk: T[]) => Promise<Map<string, V>>
): Promise<Map<string, V>> {
  const merged = new Map<string, V>();
  if (items.length === 0) return merged;
  for (const partial of await Promise.all(planChunks(items).map(worker))) {
    for (const [key, value] of partial) merged.set(key, value);
  }
  return merged;
}

const CORE_FIELDS = `
  number title state isDraft mergeable
  additions deletions changedFiles
  author { login }
  headRefName headRefOid baseRefName
  labels(first: 100) { nodes { name } }
  reviews(first: 100) { nodes { state author { login } } }
  reviewThreads(first: 100) { nodes { isResolved } }`;

// CODEOWNERS ownership isn't exposed as a field: GitHub applies it by opening a
// review request for each owning team, then drops the team from `reviewRequests`
// as soon as any member submits a review, stamping that review with `onBehalfOf`.
// So neither field alone separates "never asked" from "already reviewed" —
// pending requests answer the first, `onBehalfOf` the second.
//
// `asCodeOwner` separates an ownership request from a hand-picked one, and
// `reviewDecision` says whether the base ref gates merging on reviews at all —
// CODEOWNERS requests still get opened on refs that require no review, where
// they're a courtesy rather than a gate. `branchProtectionRule` would answer
// that directly but reads as null under repository rulesets.
const TEAM_REVIEW_FIELDS = `
  number
  reviewDecision
  reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { __typename ... on Team { slug } } } }
  reviews(first: 100) { nodes { state onBehalfOf(first: 10) { nodes { slug } } } }`;

// REST clamps listFiles to 100 per page anyway, so `files(first: 100)` covers
// exactly what the REST path did; beyond that the category split is a sample.
const REVIEW_INFO_FIELDS = `
  number
  additions deletions changedFiles
  reviews(first: 100) { nodes { state author { login } } }
  files(first: 100) { nodes { path additions deletions } }`;

// Check runs live under check suites rather than `statusCheckRollup`: the
// rollup returns a filtered subset (it can omit the most recent run of a
// re-run check), which would let a failing run go unseen. `checkSuites`
// matches REST's checks.listForRef exactly. It's also the expensive half of
// the fetch, which is why it's issued as its own concurrent query.
const CHECK_FIELDS = `
  number
  commits(last: 1) { nodes { commit {
    checkSuites(first: 50) { nodes { checkRuns(first: 100) {
      nodes { name status conclusion detailsUrl startedAt databaseId }
    } } }
    status { contexts { context state targetUrl } }
  } } }`;

function buildPrQuery(groups: Array<{ owner: string; repo: string; numbers: number[] }>, fields: string): string {
  const repoBlocks = groups.map(
    (g, ri) => `  r${ri}: repository(owner: ${lit(g.owner)}, name: ${lit(g.repo)}) {
${g.numbers.map((n, i) => `    p${i}: pullRequest(number: ${n}) { ${fields} }`).join("\n")}
  }`
  );
  return `query {\n${repoBlocks.join("\n")}\n}`;
}

/**
 * PR metadata, reviews and review threads. Replaces REST's pulls.get +
 * listReviews + a per-PR reviewThreads query. Cheap relative to the check
 * fetch, and it carries `headRefName`, which the containment query needs —
 * so callers can start containment off this without waiting on checks.
 */
export async function fetchPullRequestCore(
  client: GitHubClient,
  targets: PrTarget[]
): Promise<Map<string, GqlPrCore>> {
  return runChunked(targets, async (batch) => {
    const result = new Map<string, GqlPrCore>();
    const groups = groupByRepo(batch);
    const data = await graphqlPartial<Record<string, Record<string, any>>>(
      client,
      buildPrQuery(groups, CORE_FIELDS)
    );

    groups.forEach((g, ri) => {
      g.numbers.forEach((number, i) => {
        const pr = data?.[`r${ri}`]?.[`p${i}`];
        if (!pr) return;

        // Latest non-COMMENTED review per user, matching REST listReviews order.
        const latestReviewByUser = new Map<string, string>();
        for (const review of pr.reviews?.nodes ?? []) {
          if (review?.author?.login && review.state !== "COMMENTED") {
            latestReviewByUser.set(review.author.login, review.state ?? "");
          }
        }

        result.set(prKey(g.owner, g.repo, number), {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          isDraft: !!pr.isDraft,
          mergeable: pr.mergeable,
          additions: pr.additions ?? null,
          deletions: pr.deletions ?? null,
          changedFiles: pr.changedFiles ?? null,
          author: pr.author ?? null,
          headRefName: pr.headRefName ?? null,
          headRefOid: pr.headRefOid ?? null,
          baseRefName: pr.baseRefName ?? null,
          labels: (pr.labels?.nodes ?? []).map((l: any) => l?.name).filter(Boolean),
          approvedReviewCount: [...latestReviewByUser.values()].filter((s) => s === "APPROVED").length,
          unresolvedCommentCount: (pr.reviewThreads?.nodes ?? []).filter((t: any) => t && !t.isResolved).length,
        });
      });
    });

    return result;
  });
}

/**
 * Check runs and commit statuses for each PR's head commit. Replaces REST's
 * checks.listForRef + repos.getCombinedStatusForRef. Expanding check suites is
 * the slowest part of the fetch, so this is issued concurrently with other work.
 */
export async function fetchPullRequestChecks(
  client: GitHubClient,
  targets: PrTarget[]
): Promise<Map<string, GqlPrChecks>> {
  return runChunked(targets, async (batch) => {
    const result = new Map<string, GqlPrChecks>();
    const groups = groupByRepo(batch);
    const data = await graphqlPartial<Record<string, Record<string, any>>>(
      client,
      buildPrQuery(groups, CHECK_FIELDS)
    );

    groups.forEach((g, ri) => {
      g.numbers.forEach((number, i) => {
        const commit = data?.[`r${ri}`]?.[`p${i}`]?.commits?.nodes?.[0]?.commit;
        if (!commit) return;
        result.set(prKey(g.owner, g.repo, number), {
          checkRuns: (commit.checkSuites?.nodes ?? []).flatMap((s: any) => s?.checkRuns?.nodes ?? []),
          statusContexts: commit.status?.contexts ?? [],
        });
      });
    });

    return result;
  });
}

/**
 * Reviews, size stats and file list for each PR. Replaces the review-requests
 * board's per-PR REST triple (listReviews + pulls.get + listFiles), whose
 * unbounded fan-out tripped GitHub's secondary rate limit on busy boards.
 */
export async function fetchPullRequestReviewInfo(
  client: GitHubClient,
  targets: PrTarget[]
): Promise<Map<string, GqlPrReviewInfo>> {
  return runChunked(targets, async (batch) => {
    const result = new Map<string, GqlPrReviewInfo>();
    const groups = groupByRepo(batch);
    const data = await graphqlPartial<Record<string, Record<string, any>>>(
      client,
      buildPrQuery(groups, REVIEW_INFO_FIELDS)
    );

    groups.forEach((g, ri) => {
      g.numbers.forEach((number, i) => {
        const pr = data?.[`r${ri}`]?.[`p${i}`];
        if (!pr) return;
        result.set(prKey(g.owner, g.repo, number), {
          additions: pr.additions ?? null,
          deletions: pr.deletions ?? null,
          changedFiles: pr.changedFiles ?? null,
          reviews: (pr.reviews?.nodes ?? [])
            .filter((r: any) => r?.author?.login && r.state)
            .map((r: any) => ({ authorLogin: r.author.login as string, state: r.state as string })),
          files: (pr.files?.nodes ?? [])
            .filter((f: any) => f?.path)
            .map((f: any) => ({
              filename: f.path as string,
              additions: f.additions ?? 0,
              deletions: f.deletions ?? 0,
            })),
        });
      });
    });

    return result;
  });
}

/**
 * Which teams still owe a review on each PR, and which have already given one.
 * Issued as its own batched query so callers that don't need it pay nothing.
 */
export async function fetchPullRequestTeamReviews(
  client: GitHubClient,
  targets: PrTarget[]
): Promise<Map<string, GqlPrTeamReviews>> {
  return runChunked(targets, async (batch) => {
    const result = new Map<string, GqlPrTeamReviews>();
    const groups = groupByRepo(batch);
    const data = await graphqlPartial<Record<string, Record<string, any>>>(
      client,
      buildPrQuery(groups, TEAM_REVIEW_FIELDS)
    );

    groups.forEach((g, ri) => {
      g.numbers.forEach((number, i) => {
        const pr = data?.[`r${ri}`]?.[`p${i}`];
        if (!pr) return;

        const pendingTeams = (pr.reviewRequests?.nodes ?? [])
          .filter((n: any) => n?.requestedReviewer?.__typename === "Team" && n.requestedReviewer.slug)
          .map((n: any) => ({
            slug: n.requestedReviewer.slug as string,
            asCodeOwner: !!n.asCodeOwner,
          }));

        // PENDING is an unsubmitted draft review — it hasn't answered the
        // team's request yet, so it mustn't count as one.
        const reviewedTeams = (pr.reviews?.nodes ?? [])
          .filter((r: any) => r && r.state !== "PENDING")
          .flatMap((r: any) =>
            (r.onBehalfOf?.nodes ?? []).map((t: any) => t?.slug).filter(Boolean) as string[]
          );

        result.set(prKey(g.owner, g.repo, number), {
          reviewDecision: pr.reviewDecision ?? null,
          pendingTeams,
          reviewedTeams: [...new Set<string>(reviewedTeams)],
        });
      });
    });

    return result;
  });
}

const NO_CHECKS: GqlPrChecks = { checkRuns: [], statusContexts: [] };

/** Core + checks together, for callers with a single PR and nothing to overlap. */
export async function fetchPullRequests(
  client: GitHubClient,
  targets: PrTarget[]
): Promise<Map<string, GqlPullRequest>> {
  const [core, checks] = await Promise.all([
    fetchPullRequestCore(client, targets),
    fetchPullRequestChecks(client, targets),
  ]);
  const merged = new Map<string, GqlPullRequest>();
  for (const [key, pr] of core) merged.set(key, { ...pr, ...(checks.get(key) ?? NO_CHECKS) });
  return merged;
}

/**
 * Containment test: is each PR's head branch fully contained in the given
 * branches / deployed commits? Batched into one query per chunk of PRs.
 *
 * `behindBy === 0` from the PR's ref is equivalent to REST compareCommits'
 * `ahead_by === 0` with the roles reversed — head contains no commits the base
 * lacks. Since ancestry is transitive, testing the branch tip tests the whole
 * branch. Verified equal to the REST result across every open PR.
 */
export async function fetchContainment(
  client: GitHubClient,
  requests: ContainmentRequest[]
): Promise<Map<string, ContainmentResult>> {
  const actionable = requests.filter((r) => r.headRefName && r.targets.length > 0);

  return runChunked(actionable, async (batch) => {
    const result = new Map<string, ContainmentResult>();
    // Group by repo so each repository alias appears once.
    const byRepo = new Map<string, ContainmentRequest[]>();
    for (const r of batch) {
      const key = `${r.owner}/${r.repo}`;
      if (!byRepo.has(key)) byRepo.set(key, []);
      byRepo.get(key)!.push(r);
    }
    const groups = [...byRepo.values()];

    const query = `query {
${groups
  .map((reqs, ri) => `  r${ri}: repository(owner: ${lit(reqs[0].owner)}, name: ${lit(reqs[0].repo)}) {
${reqs
  .map(
    (r, i) =>
      `    p${i}: ref(qualifiedName: ${lit(`refs/heads/${r.headRefName}`)}) { ${r.targets
        .map((t, j) => `t${j}: compare(headRef: ${lit(t.ref)}) { behindBy }`)
        .join(" ")} }`
  )
  .join("\n")}
  }`)
  .join("\n")}
}`;

    const data = await graphqlPartial<Record<string, Record<string, any>>>(client, query);

    groups.forEach((reqs, ri) => {
      reqs.forEach((r, i) => {
        // A null ref means the branch isn't in the base repo (fork PR, or the
        // branch was deleted). Treat as "not contained" rather than failing.
        const node = data?.[`r${ri}`]?.[`p${i}`];
        const onBranches: string[] = [];
        const deployedOn: string[] = [];
        r.targets.forEach((t, j) => {
          if (node?.[`t${j}`]?.behindBy === 0) {
            (t.kind === "branch" ? onBranches : deployedOn).push(t.label);
          }
        });
        result.set(prKey(r.owner, r.repo, r.number), { onBranches, deployedOn });
      });
    });

    return result;
  });
}

/**
 * Aggregate check runs and commit statuses into the stored checks summary.
 * Mirrors the previous REST implementation, including its treatment of commit
 * statuses, so existing `checksDetails` payloads stay byte-compatible.
 */
export function mapChecks(checks: GqlPrChecks | undefined): ChecksResult {
  if (!checks || (checks.checkRuns.length === 0 && checks.statusContexts.length === 0)) {
    return { checksStatus: null, checksDetails: null };
  }

  // GitHub returns every iteration of a re-run check; keep only the newest per
  // name, tie-broken by id so the choice is deterministic.
  const latestByName = new Map<string, GqlCheckRun>();
  for (const run of checks.checkRuns) {
    const existing = latestByName.get(run.name);
    const startedAt = new Date(run.startedAt || 0).getTime();
    const existingStartedAt = existing ? new Date(existing.startedAt || 0).getTime() : -1;
    if (
      !existing ||
      startedAt > existingStartedAt ||
      (startedAt === existingStartedAt && (run.databaseId ?? 0) > (existing.databaseId ?? 0))
    ) {
      latestByName.set(run.name, run);
    }
  }

  const checkRunDetails = [...latestByName.values()].map((run) => ({
    name: run.name,
    status: run.status.toLowerCase(),
    conclusion: run.conclusion ? run.conclusion.toLowerCase() : null,
    url: run.detailsUrl ?? null,
  }));

  const statusDetails = checks.statusContexts.map((status) => {
    const state = status.state.toLowerCase();
    return {
      name: status.context,
      status: state === "pending" ? "in_progress" : "completed",
      conclusion: state === "success" ? "success" : state === "pending" ? null : "failure",
      url: status.targetUrl ?? null,
    };
  });

  // Check runs take precedence over statuses of the same name.
  const byName = new Map<string, (typeof checkRunDetails)[number]>();
  for (const detail of statusDetails) byName.set(detail.name, detail);
  for (const detail of checkRunDetails) byName.set(detail.name, detail);
  const details = [...byName.values()];

  const hasFailed = details.some((d) => d.conclusion === "failure" || d.conclusion === "timed_out");
  const hasPending = details.some((d) => d.status !== "completed");

  return {
    checksStatus: hasFailed ? "failing" : hasPending ? "pending" : "passing",
    checksDetails: JSON.stringify(details),
  };
}
