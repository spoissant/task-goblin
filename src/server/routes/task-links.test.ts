import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { routeClient } from "../../test/request";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { resetMergeGitHub, setMergeGitHub, type MergeGitHub } from "../services/merge-github";
import { taskLinkRoutes } from "./task-links";

const request = routeClient(taskLinkRoutes);
const ts = "'2026-01-01T00:00:00.000Z'";
// Jira and GitHub stay unconfigured: nothing here may reach them.
const githubToken = process.env.GITHUB_TOKEN;

beforeAll(() => {
  createTestTables(sqlite);
  delete process.env.GITHUB_TOKEN;
});

afterAll(() => {
  if (githubToken !== undefined) process.env.GITHUB_TOKEN = githubToken;
});

beforeEach(() => {
  for (const t of ["tasks", "repositories", "settings", "status_categories"]) sqlite.run(`DELETE FROM ${t}`);
  sqlite.run(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1)`);
  sqlite.run(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key)
    VALUES (1, 'Jira summary', 'In Progress', ${ts}, ${ts}, 'EV-1')`);
  sqlite.run(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, pr_number, pr_state)
    VALUES (2, 'ev-1-branch', 'Code Review', ${ts}, ${ts}, 1, 20, 'open')`);
  sqlite.run(`INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (3, 'Manual', 'To Do', ${ts}, ${ts})`);
  invalidateStatusConfigCache();
});

describe("POST /tasks/:id/sync", () => {
  it("answers 404 for an unknown task", async () => {
    expect((await request("POST", "/api/v1/tasks/999/sync")).status).toBe(404);
  });

  it("returns the task with no errors when it has nothing to pull", async () => {
    const res = await request("POST", "/api/v1/tasks/3/sync");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ task: { id: 3, prNumber: null, repository: null }, errors: [] });
  });

  it("reports each source's failure on its own and still returns the task", async () => {
    sqlite.run(`UPDATE tasks SET jira_key = 'EV-2' WHERE id = 2`);

    const res = await request("POST", "/api/v1/tasks/2/sync");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toMatchObject({ id: 2, prNumber: 20, repository: { repo: "alumni_connect" } });
    expect(body.errors).toEqual([
      "Jira: Jira host not configured. Set jira_host in settings.",
      "GitHub: GITHUB_TOKEN environment variable not set.",
    ]);
  });
});

describe("POST /tasks/:id/assign-pr", () => {
  it("rejects anything but a PR URL", async () => {
    const res = await request("POST", "/api/v1/tasks/1/assign-pr", { url: "https://github.com/hb/alumni_connect/issues/3" });
    expect(res.status).toBe(400);
  });

  it("takes a URL to one of the PR's pages, and answers GitHub errors with their status", async () => {
    const res = await request("POST", "/api/v1/tasks/1/assign-pr", { url: "https://github.com/hb/unknown/pull/3/files" });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("GITHUB_REPO_NOT_CONFIGURED");
  });

  it("rejects a task that already has a PR", async () => {
    const res = await request("POST", "/api/v1/tasks/2/assign-pr", { url: "https://github.com/hb/alumni_connect/pull/3" });
    expect(res.status).toBe(400);
  });
});

describe("POST /tasks/:id/assign-jira", () => {
  it("rejects an invalid Jira key", async () => {
    expect((await request("POST", "/api/v1/tasks/2/assign-jira", { key: "not a key" })).status).toBe(400);
  });

  it("rejects assigning a Jira key to a task without a PR", async () => {
    expect((await request("POST", "/api/v1/tasks/1/assign-jira", { key: "EV-2" })).status).toBe(400);
  });

  it("answers Jira not being configured with a 400", async () => {
    const res = await request("POST", "/api/v1/tasks/2/assign-jira", { key: "ev-2" });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("JIRA_NOT_CONFIGURED");
  });
});

describe("POST /tasks/:id/merge-pr", () => {
  afterEach(() => resetMergeGitHub());

  it("answers GitHub refusing the merge with GitHub's status and reason", async () => {
    sqlite.run(`INSERT INTO status_categories (name, color, done, display_order, jira_mappings)
      VALUES ('Ready to Merge', 'green', 0, 1, '["Ready to Merge"]')`);
    sqlite.run(`UPDATE tasks SET jira_key = 'EV-2', status = 'Ready to Merge', checks_status = 'passing',
      review_status = '{"decision":"APPROVED"}', merge_ready = 1 WHERE id = 2`);
    const refusal = Object.assign(new Error("Pull Request is not mergeable"), { status: 405 });
    const github: MergeGitHub = {
      mergePr: async () => { throw refusal; },
      listPullFiles: async () => [],
      runsForSha: async () => [],
      prLabels: async () => [],
      openReleasePrs: async () => [],
      approvePr: async () => {},
    };
    setMergeGitHub(github);

    const res = await request("POST", "/api/v1/tasks/2/merge-pr");

    expect(res.status).toBe(405);
    expect((await res.json()).error).toEqual({ code: "MERGE_REFUSED", message: "Pull Request is not mergeable" });
  });
});

describe("POST /tasks/from-pr", () => {
  it("requires owner, repo and a PR number", async () => {
    const res = await request("POST", "/api/v1/tasks/from-pr", { owner: "hb", repo: "alumni_connect" });
    expect(res.status).toBe(400);
  });

  it("reports GitHub's failure instead of creating a task", async () => {
    const res = await request("POST", "/api/v1/tasks/from-pr", { owner: "hb", repo: "alumni_connect", prNumber: 21 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM tasks WHERE pr_number = 21").get()).toEqual({ n: 0 });
  });
});
