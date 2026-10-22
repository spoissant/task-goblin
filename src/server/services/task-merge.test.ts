import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { PR_FIELDS } from "./github-mappers";
import { mergeSingleTask } from "./task-merge";

const ts = "'2026-01-01T00:00:00.000Z'";

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(() => {
  for (const t of ["claude_sessions", "tasks", "repositories"]) sqlite.exec(`DELETE FROM ${t}`);
  sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1)`);
});

const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

describe("mergeSingleTask", () => {
  it("merges a Jira task into a PR task, keeping the PR task", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, sprint)
      VALUES (1, 'Jira summary', 'In Progress', ${ts}, ${ts}, 'EV-1', 'Sprint 9')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, pr_number, pr_state)
      VALUES (2, 'ev-1-branch', 'Code Review', ${ts}, ${ts}, 1, 20, 'open')`);

    const task = await mergeSingleTask(2, 1);

    expect(task).toMatchObject({ id: 2, jiraKey: "EV-1", status: "In Progress", title: "Jira summary", sprint: "Sprint 9", prNumber: 20 });
    expect(await db.select().from(tasks).where(eq(tasks.id, 1))).toEqual([]);
  });

  it("gives a Jira task every PR column of the PR task merged into it, and its sessions", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key)
      VALUES (1, 'Jira summary', 'In Progress', ${ts}, ${ts}, 'EV-1')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, pr_number, pr_state, head_branch,
        head_sha, merge_commit_sha, has_conflicts, additions, label_only_deployment_branches, deployed_on_branches)
      VALUES (2, 'fix polls [EV-1]', 'Code Review', ${ts}, ${ts}, 1, 20, 'open', 'fix/EV-1', 'head1', NULL, 1, 12, '["staging"]', '["wip"]')`);
    await db.insert(claudeSessions).values({
      taskId: 2, choreKey: "custom", choreName: "Custom", prompt: "p", cwd: "/", name: "n", state: "done", createdAt: "x", updatedAt: "x",
    });
    const pr = await load(2);

    const task = await mergeSingleTask(1, 2);

    for (const field of PR_FIELDS) expect(task[field]).toEqual(pr[field]);
    expect(task).toMatchObject({ id: 1, title: "Jira summary", status: "In Progress" });
    expect((await db.select().from(claudeSessions))[0].taskId).toBe(1);
  });

  it("merges a PR-only task into a Jira task that already holds the PR", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, pr_number, pr_state)
      VALUES (1, 'fix polls [EV-1]', 'Done', ${ts}, ${ts}, 1, 20, 'merged'),
             (2, 'Jira summary', 'Done', ${ts}, ${ts}, 1, 20, 'merged')`);
    sqlite.exec(`UPDATE tasks SET jira_key = 'EV-1' WHERE id = 2`);

    expect(await mergeSingleTask(2, 1)).toMatchObject({ id: 2, jiraKey: "EV-1", prNumber: 20, title: "Jira summary" });
    expect(await load(1)).toBeUndefined();
  });

  it("refuses to merge a task with itself", async () => {
    await expect(mergeSingleTask(1, 1)).rejects.toMatchObject({ statusCode: 400 });
  });
});
