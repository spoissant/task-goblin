// The GitHub calls the merge gate and the merge watch make, behind a port so
// tests stub them. Mutations go through Octokit without retries (github-client.ts).
import { getGitHubClient, getGitHubConfig } from "../lib/github-client";

export interface PrTarget {
  owner: string;
  repo: string;
  number: number;
}

export interface ActionsRun {
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  htmlUrl: string;
}

export interface PullFile {
  filename: string;
  patch: string | null;
}

export interface ReleasePr {
  number: number;
  title: string;
  approvedByMe: boolean;
}

export interface MergeGitHub {
  /** Squash-merge now; GitHub refuses when branch protection is not met. Returns the merge commit. */
  mergePr(t: PrTarget): Promise<{ sha: string }>;
  listPullFiles(t: PrTarget): Promise<PullFile[]>;
  runsForSha(owner: string, repo: string, sha: string): Promise<ActionsRun[]>;
  prLabels(t: PrTarget): Promise<string[]>;
  /** Open PRs labelled `release`, with whether the configured user already approved each. */
  openReleasePrs(owner: string, repo: string): Promise<ReleasePr[]>;
  approvePr(t: PrTarget): Promise<void>;
}

type Octokit = ReturnType<typeof getGitHubClient>;

interface RunJson {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  head_sha: string;
  html_url: string;
}

const toRun = (r: RunJson): ActionsRun => ({
  name: r.name ?? "",
  status: r.status ?? "",
  conclusion: r.conclusion ?? null,
  headSha: r.head_sha,
  htmlUrl: r.html_url,
});

function createDefault(): MergeGitHub {
  const client = () => getGitHubClient();
  return {
    async mergePr(t) {
      const { data } = await client().pulls.merge({ owner: t.owner, repo: t.repo, pull_number: t.number, merge_method: "squash" });
      return { sha: data.sha };
    },
    async listPullFiles(t) {
      const { data } = await client().pulls.listFiles({ owner: t.owner, repo: t.repo, pull_number: t.number, per_page: 100 });
      return data.map((f) => ({ filename: f.filename, patch: f.patch ?? null }));
    },
    async runsForSha(owner, repo, sha) {
      const { data } = await client().actions.listWorkflowRunsForRepo({ owner, repo, head_sha: sha, per_page: 50 });
      return data.workflow_runs.map(toRun);
    },
    async prLabels(t) {
      const { data } = await client().pulls.get({ owner: t.owner, repo: t.repo, pull_number: t.number });
      return data.labels.map((l) => l.name);
    },
    async openReleasePrs(owner, repo) {
      const c = client();
      const { username } = await getGitHubConfig();
      const { data: prs } = await c.pulls.list({ owner, repo, state: "open", per_page: 50 });
      const release = prs.filter((pr) => pr.labels.some((l) => l.name === "release"));
      const out: ReleasePr[] = [];
      for (const pr of release) {
        const { data: reviews } = await c.pulls.listReviews({ owner, repo, pull_number: pr.number, per_page: 100 });
        const approvedByMe = reviews.some((r) => r.user?.login === username && r.state === "APPROVED");
        out.push({ number: pr.number, title: pr.title, approvedByMe });
      }
      return out;
    },
    async approvePr(t) {
      await client().pulls.createReview({ owner: t.owner, repo: t.repo, pull_number: t.number, event: "APPROVE" });
    },
  };
}

let instance: MergeGitHub | null = null;

export function getMergeGitHub(): MergeGitHub {
  if (!instance) instance = createDefault();
  return instance;
}

/** Test seam. */
export function setMergeGitHub(stub: MergeGitHub): void {
  instance = stub;
}

export function resetMergeGitHub(): void {
  instance = null;
}
