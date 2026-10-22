import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  BuildkiteConfigError,
  buildForCommit,
  mapBuildState,
  pipelineFor,
  resetBuildkiteFetch,
  setBuildkiteFetch,
} from "./buildkite-client";

const BUILD = {
  number: 7,
  state: "passed",
  commit: "abc123",
  web_url: "https://buildkite.com/hivebrite/alumni-connect/builds/7",
  finished_at: "2026-10-21T10:00:00Z",
};

describe("buildkite client", () => {
  const calls: Array<{ url: string; auth: string | null }> = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.BUILDKITE_API_TOKEN = "bk-token";
    setBuildkiteFetch(async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), auth: headers.get("Authorization") });
      return new Response(JSON.stringify([BUILD]), { status: 200 });
    });
  });

  afterEach(() => {
    resetBuildkiteFetch();
    delete process.env.BUILDKITE_API_TOKEN;
  });

  it("maps Buildkite states onto the four stored ones", () => {
    expect(mapBuildState(null)).toBe("missing");
    expect(mapBuildState(undefined)).toBe("missing");
    expect(mapBuildState("passed")).toBe("passed");
    for (const s of ["failed", "failing", "canceled", "canceling", "timed_out"]) expect(mapBuildState(s)).toBe("failed");
    for (const s of ["running", "scheduled", "blocked", "creating", "not_run"]) expect(mapBuildState(s)).toBe("pending");
  });

  it("knows the pipeline of repos that build on Buildkite", () => {
    expect(pipelineFor("alumni_connect")).toBe("alumni-connect");
    expect(pipelineFor("front-monorepo")).toBeNull();
  });

  it("asks for a commit's build on a branch with the bearer token", async () => {
    const build = await buildForCommit("alumni-connect", "sprint", "abc123");

    expect(build).toEqual({ number: 7, state: "passed", commit: "abc123", webUrl: BUILD.web_url, finishedAt: BUILD.finished_at });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://api.buildkite.com/v2/organizations/hivebrite/pipelines/alumni-connect/builds");
    expect(url.searchParams.get("branch")).toBe("sprint");
    expect(url.searchParams.get("per_page")).toBe("1");
    expect(calls[0].auth).toBe("Bearer bk-token");
  });

  it("filters by commit for a merge commit's build and returns null when there is none", async () => {
    setBuildkiteFetch(async (input) => {
      calls.push({ url: String(input), auth: null });
      return new Response("[]", { status: 200 });
    });

    expect(await buildForCommit("alumni-connect", "sprint", "deadbeef")).toBeNull();
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("commit")).toBe("deadbeef");
    expect(url.searchParams.get("branch")).toBe("sprint");
    expect(url.searchParams.has("state[]")).toBe(false);
  });

  it("throws BuildkiteConfigError without a token, before any request", async () => {
    delete process.env.BUILDKITE_API_TOKEN;

    await expect(buildForCommit("alumni-connect", "sprint", "abc")).rejects.toBeInstanceOf(BuildkiteConfigError);
    expect(calls).toHaveLength(0);
  });

  it("surfaces non-2xx responses as errors", async () => {
    setBuildkiteFetch(async () => new Response("nope", { status: 401 }));

    await expect(buildForCommit("alumni-connect", "sprint", "abc")).rejects.toThrow(/401/);
  });
});
