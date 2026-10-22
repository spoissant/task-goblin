import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { findAutoMatches, mergeSingleTask } from "./task-merge";

const ts = "'2026-01-01T00:00:00.000Z'";

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(() => {
  for (const t of ["tasks", "repositories", "status_categories"]) sqlite.exec(`DELETE FROM ${t}`);
  sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1), (2, 'hb', 'hivetests', 1)`);
  sqlite.exec(`INSERT INTO status_categories (name, color, done, display_order, jira_mappings)
    VALUES ('In Progress', 'blue', 0, 1, '[]'), ('Done', 'green', 1, 2, '[]')`);
});

describe("findAutoMatches", () => {
  it("pairs a hivetests PR with its sub-task, not with the parent whose key is in the branch", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, repository_id, pr_number, head_branch, pr_state)
      VALUES (1, 'Poll deletion', 'In Progress', ${ts}, ${ts}, 'EV-1', 1, NULL, NULL, NULL),
             (2, '[hivetests] Hermetic specs', 'In Progress', ${ts}, ${ts}, 'EV-2', 2, NULL, NULL, NULL),
             (3, 'test(polls): delete a poll [EV-2]', 'In Progress', ${ts}, ${ts}, NULL, 2, 7, 'feat/EV-1', 'open')`);

    expect(await findAutoMatches()).toEqual([{ jiraTaskId: 2, prTaskId: 3, jiraKey: "EV-2" }]);
  });
});

describe("mergeSingleTask", () => {
  it("merges a Jira task into a PR task, keeping the PR task", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key)
      VALUES (1, 'Jira summary', 'In Progress', ${ts}, ${ts}, 'EV-1')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, pr_number, pr_state)
      VALUES (2, 'ev-1-branch', 'Code Review', ${ts}, ${ts}, 1, 20, 'open')`);

    const task = await mergeSingleTask(2, 1);

    expect(task).toMatchObject({ id: 2, jiraKey: "EV-1", status: "In Progress", title: "Jira summary", prNumber: 20 });
    expect(await db.select().from(tasks).where(eq(tasks.id, 1))).toEqual([]);
  });
});
