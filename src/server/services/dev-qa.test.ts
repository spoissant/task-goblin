import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { statusCategories, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { resetMergeJira, setMergeJira, type IssueTransitions } from "./merge-jira";
import { moveToReadyForTest } from "./dev-qa";

const NOW = "2026-10-29T00:00:00.000Z";
const TO_TEST = { id: "31", to: "Ready for Test" };

describe("moveToReadyForTest", () => {
  const calls: string[] = [];
  let issue: IssueTransitions;

  beforeAll(() => {
    createTestTables(sqlite);
  });

  beforeEach(async () => {
    calls.length = 0;
    issue = { status: "Code review", transitions: [{ id: "11", to: "In Progress" }, TO_TEST] };
    sqlite.run("DELETE FROM tasks");
    sqlite.run("DELETE FROM status_categories");
    invalidateStatusConfigCache();
    await db.insert(statusCategories).values([
      { name: "Code Review", color: "y", done: 0, displayOrder: 1, jiraMappings: JSON.stringify(["Code Review"]) },
      { name: "QA", color: "b", done: 0, displayOrder: 2, jiraMappings: JSON.stringify(["Ready for Test"]) },
    ]);
    setMergeJira({
      async issueTransitions(key) {
        calls.push(`read ${key}`);
        return issue;
      },
      async transition(key, id) {
        calls.push(`transition ${key} ${id}`);
      },
    });
  });

  afterEach(() => {
    resetMergeJira();
    sqlite.run("DELETE FROM tasks");
  });

  async function insert(over: Partial<typeof tasks.$inferInsert> = {}): Promise<number> {
    const [row] = await db
      .insert(tasks)
      .values({
        title: "t",
        status: "Code review",
        createdAt: NOW,
        updatedAt: NOW,
        jiraKey: "EV-1",
        prNumber: 10,
        prState: "open",
        isDraft: 0,
        checksStatus: "passing",
        unresolvedCommentCount: 0,
        hasConflicts: 0,
        onDeploymentBranches: '["staging"]',
        deployedOnBranches: '["staging"]',
        ...over,
      })
      .returning({ id: tasks.id });
    return row.id;
  }

  const statusOf = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0].status;

  it("transitions the Jira ticket to Ready for Test", async () => {
    const id = await insert();

    expect((await moveToReadyForTest(id)).status).toBe("Ready for Test");
    expect(calls).toEqual(["read EV-1", "transition EV-1 31"]);
    expect(await statusOf(id)).toBe("Ready for Test");
  });

  it("only changes the status of a task without a ticket", async () => {
    const id = await insert({ jiraKey: null });

    await moveToReadyForTest(id);
    expect(calls).toEqual([]);
    expect(await statusOf(id)).toBe("Ready for Test");
  });

  it("refuses a task outside Code Review", async () => {
    const id = await insert({ status: "In Progress" });

    await expect(moveToReadyForTest(id)).rejects.toMatchObject({ code: "NOT_DEV_QA_READY" });
    expect(calls).toEqual([]);
  });

  it("refuses a PR an env is still rolling out", async () => {
    const id = await insert({ deployedOnBranches: "[]" });

    await expect(moveToReadyForTest(id)).rejects.toMatchObject({ code: "NOT_DEV_QA_READY" });
    expect(calls).toEqual([]);
  });

  it("refuses when Jira has no transition to Ready for Test, leaving the status", async () => {
    issue = { status: "Code review", transitions: [{ id: "11", to: "In Progress" }] };
    const id = await insert();

    await expect(moveToReadyForTest(id)).rejects.toMatchObject({ code: "NO_TRANSITION" });
    expect(await statusOf(id)).toBe("Code review");
  });

  it("answers not found for an unknown task", async () => {
    await expect(moveToReadyForTest(999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
