import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { findAutoMatches } from "./task-merge";

describe("findAutoMatches", () => {
  beforeAll(() => {
    createTestTables(sqlite);
  });

  beforeEach(() => {
    for (const t of ["tasks", "repositories", "status_categories"]) sqlite.exec(`DELETE FROM ${t}`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1), (2, 'hb', 'hivetests', 1)`);
    sqlite.exec(`INSERT INTO status_categories (name, color, done, display_order, jira_mappings)
      VALUES ('In Progress', 'blue', 0, 1, '[]'), ('Done', 'green', 1, 2, '[]')`);
  });

  it("pairs a hivetests PR with its sub-task, not with the parent whose key is in the branch", async () => {
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, repository_id, pr_number, head_branch, pr_state)
      VALUES (1, 'Poll deletion', 'In Progress', ${ts}, ${ts}, 'EV-1', 1, NULL, NULL, NULL),
             (2, '[hivetests] Hermetic specs', 'In Progress', ${ts}, ${ts}, 'EV-2', 2, NULL, NULL, NULL),
             (3, 'test(polls): delete a poll [EV-2]', 'In Progress', ${ts}, ${ts}, NULL, 2, 7, 'feat/EV-1', 'open')`);

    expect(await findAutoMatches()).toEqual([{ jiraTaskId: 2, prTaskId: 3, jiraKey: "EV-2" }]);
  });
});
