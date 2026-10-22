// Read-only Buildkite REST client for the merge watch (the build of a merge
// commit). Token: BUILDKITE_API_TOKEN
// (read_builds). Only alumni_connect builds on Buildkite; the other repos use
// GitHub Actions (see merge-github.ts).
import type { BaseBuildState } from "@/shared/merge";

const API_BASE = "https://api.buildkite.com/v2/organizations/hivebrite/pipelines";

/** Buildkite pipeline slug per repository name. Repos not listed don't build on Buildkite. */
export const BUILDKITE_PIPELINES: Record<string, string> = { alumni_connect: "alumni-connect" };

export function pipelineFor(repoName: string): string | null {
  return BUILDKITE_PIPELINES[repoName] ?? null;
}

export class BuildkiteConfigError extends Error {
  constructor() {
    super("BUILDKITE_API_TOKEN environment variable not set.");
    this.name = "BuildkiteConfigError";
  }
}

export interface BkBuild {
  number: number;
  state: string;
  commit: string;
  webUrl: string;
  finishedAt: string | null;
}

interface BkBuildJson {
  number: number;
  state: string;
  commit: string;
  web_url: string;
  finished_at: string | null;
}

/** The slice of fetch the client uses; Bun's `typeof fetch` also carries `preconnect`. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = fetch;

/** Test seam: swap the fetch used for Buildkite calls. */
export function setBuildkiteFetch(fn: FetchLike): void {
  fetchImpl = fn;
}

export function resetBuildkiteFetch(): void {
  fetchImpl = fetch;
}

async function listBuilds(pipeline: string, params: URLSearchParams): Promise<BkBuild[]> {
  const token = process.env.BUILDKITE_API_TOKEN;
  if (!token) throw new BuildkiteConfigError();
  const url = `${API_BASE}/${encodeURIComponent(pipeline)}/builds?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Buildkite ${res.status} for ${url}`);
  const body = (await res.json()) as BkBuildJson[];
  return body.map((b) => ({
    number: b.number,
    state: b.state,
    commit: b.commit,
    webUrl: b.web_url,
    finishedAt: b.finished_at ?? null,
  }));
}

/** The build of one commit on `branch` (any state), or null when Buildkite hasn't seen it. */
export async function buildForCommit(pipeline: string, branch: string, sha: string): Promise<BkBuild | null> {
  const params = new URLSearchParams({ branch, commit: sha, per_page: "1" });
  const builds = await listBuilds(pipeline, params);
  return builds[0] ?? null;
}

const FAILED_STATES = new Set(["failed", "failing", "canceled", "canceling", "timed_out"]);

/** Collapse Buildkite's build states into the four the task row stores. */
export function mapBuildState(state: string | null | undefined): BaseBuildState {
  if (state == null) return "missing";
  if (state === "passed") return "passed";
  if (FAILED_STATES.has(state)) return "failed";
  return "pending";
}
