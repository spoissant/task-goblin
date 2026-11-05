import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { extractBlockedBy, upsertTask } from "./jira-sync";

describe("extractBlockedBy", () => {
  it("keeps only the issues this one is blocked by", () => {
    const fields = {
      issuelinks: [
        { type: { name: "Blocks" }, inwardIssue: { key: "EV-1", fields: { status: { name: "In Progress" } } } },
        { type: { name: "Blocks" }, outwardIssue: { key: "EV-2", fields: { status: { name: "To Do" } } } },
        { type: { name: "Relates" }, inwardIssue: { key: "EV-3", fields: { status: { name: "Done" } } } },
      ],
    };

    expect(JSON.parse(extractBlockedBy(fields)!)).toEqual([{ key: "EV-1", status: "In Progress" }]);
  });

  it("is null without blocking links", () => {
    expect(extractBlockedBy({})).toBeNull();
    expect(extractBlockedBy({ issuelinks: [] })).toBeNull();
  });
});

describe("upsertTask and goal epics", () => {
  beforeAll(() => createTestTables(sqlite));
  beforeEach(() => {
    sqlite.run("DELETE FROM tasks");
    sqlite.run("DELETE FROM goals");
    sqlite.run("INSERT INTO goals (id, name, epic_keys, display_order, created_at, updated_at) VALUES (1, 'Editor', '[\"PS-9\"]', 0, 'x', 'x')");
    sqlite.run("INSERT INTO goals (id, name, display_order, created_at, updated_at) VALUES (2, 'Other', 1, 'x', 'x')");
  });

  const issue = (jiraKey: string, epicKey: string | null) => ({
    jiraKey,
    title: jiraKey,
    status: "To Do",
    type: "Story",
    assignee: null,
    priority: null,
    sprint: null,
    epicKey,
    parentKey: null,
    blockedBy: null,
    updatedAt: "2026-11-05T00:00:00.000Z",
  });
  const goalOf = (jiraKey: string) =>
    (sqlite.query("SELECT goal_id FROM tasks WHERE jira_key = ?").get(jiraKey) as { goal_id: number | null }).goal_id;

  it("puts a new task of a tied epic in the goal, and leaves others unassigned", async () => {
    await upsertTask(issue("PS-1", "PS-9"));
    await upsertTask(issue("PS-2", "PS-8"));
    await upsertTask(issue("PS-3", null));
    expect([goalOf("PS-1"), goalOf("PS-2"), goalOf("PS-3")]).toEqual([1, null, null]);
  });

  it("puts a task that moves into a tied epic in the goal, but never moves one already in a goal", async () => {
    await upsertTask(issue("PS-1", null));
    await upsertTask(issue("PS-2", null));
    sqlite.run("UPDATE tasks SET goal_id = 2 WHERE jira_key = 'PS-2'");
    await upsertTask(issue("PS-1", "PS-9"));
    await upsertTask(issue("PS-2", "PS-9"));
    expect([goalOf("PS-1"), goalOf("PS-2")]).toEqual([1, 2]);
  });

  it("does not re-assign a task the user took out of the goal while its epic is unchanged", async () => {
    await upsertTask(issue("PS-1", "PS-9"));
    sqlite.run("UPDATE tasks SET goal_id = NULL WHERE jira_key = 'PS-1'");
    await upsertTask({ ...issue("PS-1", "PS-9"), status: "In Progress" });
    expect(goalOf("PS-1")).toBeNull();
  });

  it("makes a sub-task follow its parent's epic", async () => {
    await upsertTask(issue("PS-1", "PS-9"));
    await upsertTask({ ...issue("PS-2", null), parentKey: "PS-1" });
    await upsertTask({ ...issue("PS-3", null), parentKey: "PS-404" }); // parent not tracked: nothing to follow
    expect([goalOf("PS-2"), goalOf("PS-3")]).toEqual([1, null]);
  });

  it("brings sub-tasks that synced before their parent along", async () => {
    await upsertTask({ ...issue("PS-2", null), parentKey: "PS-1" });
    await upsertTask({ ...issue("PS-4", null), parentKey: "PS-1" });
    sqlite.run("UPDATE tasks SET goal_id = 2 WHERE jira_key = 'PS-4'");
    await upsertTask(issue("PS-1", "PS-9"));
    expect([goalOf("PS-1"), goalOf("PS-2"), goalOf("PS-4")]).toEqual([1, 1, 2]);
  });

  it("ignores archived goals", async () => {
    sqlite.run("UPDATE goals SET archived = 1 WHERE id = 1");
    await upsertTask(issue("PS-1", "PS-9"));
    expect(goalOf("PS-1")).toBeNull();
  });
});
