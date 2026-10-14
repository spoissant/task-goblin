import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks, statusCategories } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { getChores } from "./chores";
import type { ReviewDecision, ReviewStatus } from "@/shared/review-status";

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

const reviewStatus = (decision: ReviewDecision, approvedCount: number, missingCodeOwners: string[] = []) =>
  JSON.stringify({
    decision,
    approvedCount,
    requiredApprovals: 1,
    missingCodeOwners,
    optionalCodeOwners: [],
    changesRequestedBy: [],
    baseBranch: "main",
  } satisfies ReviewStatus);

describe("getChores — chore 9 explain-me-why", () => {
  it("suggests explain-me-why as chore 9 for an open PR ready for review", async () => {
    const task = await seedTask();

    const entries = await getChores({ taskId: task.id });

    expect(entries.find((e) => e.key === "explain-me-why")?.number).toBe(9);
  });

  it("does not suggest explain-me-why while the PR is a draft", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ isDraft: 1 }).where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("explain-me-why");
  });

  it("stops suggesting explain-me-why once its chore skip is set", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ choreSkips: JSON.stringify({ "explain-me-why": true }) }).where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("explain-me-why");
  });
});

describe("getChores — chore 11 request-reviews", () => {
  it("suggests request-reviews for an open, ready PR short of approvals", async () => {
    const task = await seedTask();

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("request-reviews");
  });

  it("stops suggesting request-reviews once GitHub says the reviews are done", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ reviewStatus: reviewStatus("APPROVED", 1) }).where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("request-reviews");
  });

  it("keeps suggesting request-reviews while a code owner is missing despite enough approvals", async () => {
    const task = await seedTask();
    await db
      .update(tasks)
      .set({ reviewStatus: reviewStatus("REVIEW_REQUIRED", 1, ["squad-fe"]) })
      .where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("request-reviews");
  });

  it("stops suggesting request-reviews once its chore skip is set", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ choreSkips: JSON.stringify({ "request-reviews": true }) }).where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("request-reviews");
    expect(keys).toContain("continue-work");
  });
});
