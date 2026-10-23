import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { routeClient } from "../../test/request";
import { repositoryRoutes } from "./repositories";

const request = routeClient(repositoryRoutes);

beforeAll(() => createTestTables(sqlite));

beforeEach(() => {
  sqlite.run("DELETE FROM tasks");
  sqlite.run("DELETE FROM repositories");
});

async function createRepo(body: Record<string, unknown> = {}) {
  const res = await request("POST", "/api/v1/repositories", { owner: "Hivebrite", repo: "front-monorepo", ...body });
  expect(res.status).toBe(201);
  return res.json();
}

describe("GET /api/v1/repositories", () => {
  it("lists repositories with their checkout path", async () => {
    await createRepo({ localPath: "~/Code/front-monorepo" });

    const data = await (await request("GET", "/api/v1/repositories")).json();
    expect(data.total).toBe(1);
    expect(data.items[0]).toMatchObject({ repo: "front-monorepo", localPath: "~/Code/front-monorepo" });
    expect(data.items[0].worktrees).toBeUndefined();
  });
});

describe("POST /api/v1/repositories", () => {
  it("requires owner and repo", async () => {
    expect((await request("POST", "/api/v1/repositories", { repo: "x" })).status).toBe(400);
    expect((await request("POST", "/api/v1/repositories", { owner: "x", repo: "  " })).status).toBe(400);
  });

  it("normalizes the fields it is given and defaults the rest", async () => {
    const repo = await createRepo({ alias: " fm ", localPath: " ~/Code/fm ", deploymentBranches: [] });
    expect(repo).toMatchObject({ alias: "fm", localPath: "~/Code/fm", enabled: 1, deploymentBranches: null, badgeColor: null });
  });
});

describe("PATCH /api/v1/repositories/:id", () => {
  it("saves a checkout path, keeping the ~", async () => {
    const { id } = await createRepo();
    const res = await request("PATCH", `/api/v1/repositories/${id}`, { localPath: "~/Code/hivebrite/front-monorepo " });
    expect(res.status).toBe(200);
    expect((await res.json()).localPath).toBe("~/Code/hivebrite/front-monorepo");
  });

  it("clears the checkout path with an empty string or null", async () => {
    const { id } = await createRepo({ localPath: "~/Code/fm" });
    expect((await (await request("PATCH", `/api/v1/repositories/${id}`, { localPath: "" })).json()).localPath).toBeNull();

    await request("PATCH", `/api/v1/repositories/${id}`, { localPath: "~/Code/fm" });
    expect((await (await request("PATCH", `/api/v1/repositories/${id}`, { localPath: null })).json()).localPath).toBeNull();
  });

  it("rejects a checkout path that isn't a string", async () => {
    const { id } = await createRepo();
    const res = await request("PATCH", `/api/v1/repositories/${id}`, { localPath: 42 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("leaves fields the body doesn't mention unchanged", async () => {
    const { id } = await createRepo({ alias: "fm", localPath: "~/Code/fm" });
    const repo = await (await request("PATCH", `/api/v1/repositories/${id}`, { enabled: false, deploymentUrls: { staging: "https://s" } })).json();
    expect(repo).toMatchObject({ alias: "fm", localPath: "~/Code/fm", enabled: 0, deploymentUrls: '{"staging":"https://s"}' });
  });

  it("answers 404 for an unknown repository", async () => {
    expect((await request("PATCH", "/api/v1/repositories/999", { localPath: "/x" })).status).toBe(404);
  });
});

describe("DELETE /api/v1/repositories/:id", () => {
  it("refuses while tasks reference the repository", async () => {
    const { id } = await createRepo();
    sqlite.run(`INSERT INTO tasks (title, status, created_at, updated_at, repository_id) VALUES ('t', 'To Do', 'x', 'x', ${id})`);
    expect((await request("DELETE", `/api/v1/repositories/${id}`)).status).toBe(409);
  });

  it("deletes an unused repository", async () => {
    const { id } = await createRepo();
    expect((await request("DELETE", `/api/v1/repositories/${id}`)).status).toBe(204);
    expect((await (await request("GET", "/api/v1/repositories")).json()).total).toBe(0);
  });
});
