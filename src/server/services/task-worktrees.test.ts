import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { createRouter, type Routes } from "../router";
import { routes } from "../routes";
import { withErrorBoundary } from "../middleware";
import { parseWorktreeList } from "../lib/git";
import { resetCommandRunner, setCommandRunner, type CommandOptions, type CommandResult } from "../lib/process";
import { ensureTaskWorktree, getTaskWorktreeRow, worktreePathFor, worktreeKeyFor } from "./task-worktrees";
import { mergeSingleTask } from "./task-merge";

const ok = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });

describe("worktree helpers", () => {
  it("names the worktree as a sibling of the main checkout", () => {
    expect(worktreePathFor("~/Code/hivebrite/alumni_connect/alumni_connect", "EV-3769")).toBe(
      "~/Code/hivebrite/alumni_connect/alumni_connect.EV-3769",
    );
    expect(worktreePathFor("/repo/front-monorepo/", "PS-1")).toBe("/repo/front-monorepo.PS-1");
  });

  it("falls back to the task id when there is no Jira key", () => {
    expect(worktreeKeyFor({ id: 42, jiraKey: null })).toBe("task-42");
    expect(worktreeKeyFor({ id: 42, jiraKey: "EV-1" })).toBe("EV-1");
  });

  it("parses git worktree list --porcelain", () => {
    const porcelain = [
      "worktree /a/main",
      "HEAD abc",
      "branch refs/heads/sprint",
      "",
      "worktree /a/main.EV-1",
      "HEAD def",
      "detached",
      "",
    ].join("\n");
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/a/main", branch: "sprint" },
      { path: "/a/main.EV-1", branch: null },
    ]);
  });
});

describe("task worktree routes", () => {
  let router: ReturnType<typeof createRouter>;

  const request = (method: string, path: string, body?: unknown) =>
    withErrorBoundary(() =>
      router.route(
        new Request("http://localhost" + path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }),
      ),
    );

  beforeAll(() => {
    createTestTables(sqlite);
    router = createRouter(routes as Routes);
  });

  beforeEach(() => {
    for (const t of ["claude_sessions", "task_worktrees", "todos", "tasks", "worktrees", "repositories"]) {
      sqlite.exec(`DELETE FROM ${t}`);
    }
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1), (2, 'hb', 'front-monorepo', 1)`);
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, repository_id, pr_number)
      VALUES (1, 'Old ac task', 'Done', ${ts}, ${ts}, 'EV-1', 1, 10),
             (2, 'Old ac task 2', 'Done', ${ts}, ${ts}, 'EV-2', 1, 11),
             (3, 'Old fm task', 'Done', ${ts}, ${ts}, 'EV-3', 2, 12),
             (4, 'Plain new task', 'To Do', ${ts}, ${ts}, 'EV-4', NULL, NULL),
             (5, 'Tiptap toolbar a11y', 'To Do', ${ts}, ${ts}, 'EV-5', NULL, NULL)`);
    setCommandRunner(async () => ok());
  });

  afterEach(() => resetCommandRunner());

  it("guesses from title keywords first", async () => {
    const res = await request("GET", "/api/v1/tasks/5/repository-guess");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repositoryId).toBe(2);
    expect(body.reason).toBe("title-keyword");
  });

  it("guesses from Jira project history otherwise", async () => {
    const res = await request("GET", "/api/v1/tasks/4/repository-guess");
    const body = await res.json();
    expect(body.repositoryId).toBe(1);
    expect(body.reason).toBe("jira-project");
    expect(body.candidates).toEqual([
      { repositoryId: 1, count: 2 },
      { repositoryId: 2, count: 1 },
    ]);
  });

  it("lets PATCH set repositoryId on a task without a PR only", async () => {
    const okRes = await request("PATCH", "/api/v1/tasks/4", { repositoryId: 2 });
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).repositoryId).toBe(2);

    const badRepo = await request("PATCH", "/api/v1/tasks/4", { repositoryId: 99 });
    expect(badRepo.status).toBe(400);

    const withPr = await request("PATCH", "/api/v1/tasks/1", { repositoryId: 2 });
    expect(withPr.status).toBe(400);
  });

  it("refuses to prepare a worktree without a repository or local path", async () => {
    const noRepo = await request("POST", "/api/v1/tasks/4/worktree");
    expect(noRepo.status).toBe(400);
    expect((await noRepo.json()).error.code).toBe("NO_REPOSITORY");

    const noPath = await request("POST", "/api/v1/tasks/1/worktree");
    expect(noPath.status).toBe(400);
    expect((await noPath.json()).error.code).toBe("REPO_PATH_NOT_CONFIGURED");

    const status = await request("GET", "/api/v1/tasks/1/worktree");
    expect(status.status).toBe(200);
    expect(await status.json()).toBeNull();
  });

  it("repoints a stale worktree row when the task moved to another repository", async () => {
    const ts = "'2026-01-01T00:00:00.000Z'";
    const main = join(mkdtempSync(join(tmpdir(), "tg-")), "alumni_connect");
    mkdirSync(main);
    sqlite.exec(`INSERT INTO worktrees (repository_id, path, created_at, updated_at) VALUES (1, '${main}', ${ts}, ${ts})`);
    sqlite.exec(`INSERT INTO task_worktrees (task_id, repository_id, path, state, error, created_at, updated_at)
      VALUES (1, 2, '/elsewhere/front-monorepo.EV-1', 'failed', 'old error', ${ts}, ${ts})`);
    const porcelain = `worktree ${main}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${main}.EV-1\nHEAD def\ndetached\n`;
    setCommandRunner(async (_cmd, args) => ok(args.includes("list") ? porcelain : ""));

    await ensureTaskWorktree(1);

    const row = await getTaskWorktreeRow(1);
    expect(row?.repositoryId).toBe(1);
    expect(row?.path).toBe(`${main}.EV-1`);
    expect(row?.state).toBe("ready");
    expect(row?.error).toBeNull();
  });

  it("tears down the stack of a deleted task even when its worktree folder is gone", async () => {
    const ts = "'2026-01-01T00:00:00.000Z'";
    const main = join(mkdtempSync(join(tmpdir(), "tg-")), "alumni_connect");
    mkdirSync(main);
    sqlite.exec(`UPDATE repositories SET teardown_command = 'bin/dev worktree-cleanup {{composeProject}}' WHERE id = 1`);
    sqlite.exec(`INSERT INTO worktrees (repository_id, path, created_at, updated_at) VALUES (1, '${main}', ${ts}, ${ts})`);
    sqlite.exec(`INSERT INTO task_worktrees (task_id, repository_id, path, state, created_at, updated_at)
      VALUES (1, 1, '${main}.EV-1', 'ready', ${ts}, ${ts})`);
    const calls: { args: string[]; opts: CommandOptions }[] = [];
    setCommandRunner(async (_cmd, args, opts) => {
      calls.push({ args, opts });
      return ok();
    });

    const res = await request("DELETE", "/api/v1/tasks/1");

    expect(res.status).toBe(204);
    const teardown = calls.find((c) => c.args.some((a) => a.includes("worktree-cleanup")));
    expect(teardown?.args).toContain("bin/dev worktree-cleanup alumni_connect_ev_1");
    expect(teardown?.opts.cwd).toBe(main);
    expect(await getTaskWorktreeRow(1)).toBeNull();
  });

  it("moves the source task's worktree to the target on merge", async () => {
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, pr_number, pr_state)
      VALUES (6, 'PR for EV-4', 'open', ${ts}, ${ts}, 1, 20, 'open')`);
    sqlite.exec(`INSERT INTO task_worktrees (task_id, repository_id, path, state, created_at, updated_at)
      VALUES (6, 1, '/repo/alumni_connect.task-6', 'ready', ${ts}, ${ts})`);

    await mergeSingleTask(4, 6);

    expect((await getTaskWorktreeRow(4))?.path).toBe("/repo/alumni_connect.task-6");
  });
});
