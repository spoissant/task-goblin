import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { statusCategories, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { resetMergeJira, runMergeJira, setMergeJira, type IssueTransitions } from "./merge-jira";

const NOW = "2026-10-22T00:00:00.000Z";
const TO_PROD = { id: "41", to: "Ready to Prod" };
const inReadyToMerge = (...transitions: IssueTransitions["transitions"]): IssueTransitions => ({
  status: "Ready to Merge",
  transitions,
});

describe("merge jira", () => {
  const calls: string[] = [];
  let issues: Record<string, IssueTransitions | Error> = {};

  beforeAll(() => {
    createTestTables(sqlite);
  });

  beforeEach(async () => {
    calls.length = 0;
    issues = {};
    sqlite.run("DELETE FROM tasks");
    sqlite.run("DELETE FROM status_categories");
    invalidateStatusConfigCache();
    await db.insert(statusCategories).values([
      { name: "Ready to Merge", color: "g", done: 0, displayOrder: 1, jiraMappings: JSON.stringify(["Ready to Merge"]) },
      { name: "Done", color: "g", done: 1, displayOrder: 2, jiraMappings: JSON.stringify(["Ready to Prod", "Done"]) },
    ]);
    setMergeJira({
      async issueTransitions(key) {
        calls.push(`read ${key}`);
        const issue = issues[key];
        if (issue instanceof Error) throw issue;
        return issue;
      },
      async transition(key, id) {
        calls.push(`transition ${key} ${id}`);
      },
    });
  });

  afterEach(() => {
    resetMergeJira();
    sqlite.run("DELETE FROM tasks"); // the sync scheduler tests run the real step
  });

  async function insert(jiraKey: string | null, over: Partial<typeof tasks.$inferInsert> = {}): Promise<number> {
    const [row] = await db
      .insert(tasks)
      .values({ title: "t", status: "Ready to Merge", createdAt: NOW, updatedAt: NOW, jiraKey, prNumber: 10, prState: "merged", ...over })
      .returning({ id: tasks.id });
    return row.id;
  }

  const statusOf = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0].status;

  it("moves a merged PR's ticket from Ready to Merge to Ready to Prod", async () => {
    issues["EV-1"] = inReadyToMerge({ id: "11", to: "Code review" }, TO_PROD);
    const id = await insert("EV-1");

    await runMergeJira();

    expect(calls).toEqual(["read EV-1", "transition EV-1 41"]);
    expect(await statusOf(id)).toBe("Ready to Prod");

    calls.length = 0;
    await runMergeJira();
    expect(calls).toEqual([]); // a moved ticket leaves the step
  });

  it("leaves open and closed PRs, tickets past Ready to Merge and PRs without a ticket alone", async () => {
    await insert("EV-2", { prState: "open" });
    await insert("EV-3", { prState: "closed" });
    await insert("EV-4", { status: "Ready to Prod" });
    await insert("EV-5", { status: "Code Review" });
    await insert(null);

    await runMergeJira();

    expect(calls).toEqual([]);
  });

  it("takes the live status when Jira already moved the ticket", async () => {
    issues["EV-6"] = { status: "Ready to Prod", transitions: [{ id: "51", to: "Done" }] };
    const id = await insert("EV-6");

    await runMergeJira();

    expect(calls).toEqual(["read EV-6"]);
    expect(await statusOf(id)).toBe("Ready to Prod");
  });

  it("leaves the ticket in Ready to Merge when no transition reaches Ready to Prod", async () => {
    issues["EV-7"] = inReadyToMerge({ id: "11", to: "Code review" });
    const id = await insert("EV-7");

    await runMergeJira();

    expect(calls).toEqual(["read EV-7"]);
    expect(await statusOf(id)).toBe("Ready to Merge");
  });

  it("keeps going past a ticket Jira fails on", async () => {
    issues["EV-8"] = new Error("Jira down");
    issues["EV-9"] = inReadyToMerge(TO_PROD);
    const failing = await insert("EV-8");
    const moved = await insert("EV-9");

    await runMergeJira();

    expect(calls).toEqual(["read EV-8", "read EV-9", "transition EV-9 41"]);
    expect(await statusOf(failing)).toBe("Ready to Merge");
    expect(await statusOf(moved)).toBe("Ready to Prod");
  });
});
