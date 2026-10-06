import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks, statusCategories } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { getChores } from "./chores";

const NOW = "2026-08-21T00:00:00.000Z";

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(() => {
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM status_categories");
});

async function seedTask() {
  await db.insert(statusCategories).values([
    { name: "In Progress", color: "blue", done: 0, displayOrder: 1, jiraMappings: "[]" },
    { name: "Done", color: "green", done: 1, displayOrder: 2, jiraMappings: "[]" },
  ]);

  const [task] = await db
    .insert(tasks)
    .values({
      title: "Poll deletion",
      status: "In Progress",
      createdAt: NOW,
      updatedAt: NOW,
      prNumber: 42,
      headBranch: "feature/poll",
      baseBranch: "main",
      prState: "open",
      isDraft: 0,
      checksStatus: "passing",
      unresolvedCommentCount: 0,
    })
    .returning();

  return task;
}

describe("getChores — chore 4 address-pr-comments", () => {
  it("does not surface chore 4 when there are no unresolved comments", async () => {
    const task = await seedTask();

    const entries = await getChores({ taskId: task.id });

    expect(entries.find((e) => e.key === "address-pr-comments")).toBeUndefined();
  });

  it("surfaces chore 4 from unresolved PR comments", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ unresolvedCommentCount: 3 }).where(eq(tasks.id, task.id));

    const entries = await getChores({ taskId: task.id });

    expect(entries.find((e) => e.key === "address-pr-comments")?.number).toBe(4);
  });
});

describe("getChores — chores 6 and 7 (post-QA continue vs AI QA)", () => {
  it("suggests AI QA, not continue-work, for an in-progress draft PR", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ isDraft: 1 }).where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("ai-qa");
    expect(keys).not.toContain("continue-work");
  });

  it("suggests continue-work, not AI QA, for an in-progress PR ready for review", async () => {
    const task = await seedTask();

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("continue-work");
    expect(keys).not.toContain("ai-qa");
  });
});
