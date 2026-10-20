import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks, statusCategories, repositories } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { getChoreDefinition, getChoreDefinitions, getChores } from "./chores";
import { invalidateStatusConfigCache } from "./task-status";
import type { RepoPair } from "@/shared/chore-pairs";

const NOW = "2026-08-21T00:00:00.000Z";

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(() => {
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM status_categories");
  invalidateStatusConfigCache();
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

describe("getChores — chore 11 explain-me-why (manual only)", () => {
  it("never suggests explain-me-why, even for an open PR ready for review", async () => {
    const task = await seedTask();

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("explain-me-why");
  });

  it("still lists explain-me-why in the chore definitions for the AI menu", () => {
    expect(getChoreDefinitions().find((d) => d.key === "explain-me-why")?.number).toBe(11);
  });
});

describe("getChores — chore 14 validate-issue (manual only, main checkout)", () => {
  it("never suggests validate-issue, even for a Backlog task", async () => {
    await db.insert(statusCategories).values([
      { name: "Backlog", color: "gray", done: 0, displayOrder: 0, jiraMappings: "[]" },
    ]);
    const [task] = await db
      .insert(tasks)
      .values({ title: "Poll vote count is wrong", status: "Backlog", createdAt: NOW, updatedAt: NOW })
      .returning();

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("start-task");
    expect(keys).not.toContain("validate-issue");
  });

  it("lists validate-issue for the AI menu and runs it without a worktree", () => {
    expect(getChoreDefinitions().find((d) => d.key === "validate-issue")?.number).toBe(14);
    expect(getChoreDefinition("validate-issue")?.cwd).toBe("main");
  });
});

describe("getChores — chores 12 ship-upstream and 13 preview-upstream (two-repo, manual only)", () => {
  it("never suggests them", async () => {
    const task = await seedTask();

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("ship-upstream");
    expect(keys).not.toContain("preview-upstream");
  });

  it("exposes their repo pairs, and none on single-repo chores", () => {
    const defs = getChoreDefinitions();
    const pairs: RepoPair[] = [
      ["api-contracts", "alumni_connect"],
      ["front-monorepo", "alumni_connect"],
    ];
    expect(defs.find((d) => d.key === "ship-upstream")?.repoPairs).toEqual(pairs);
    expect(defs.find((d) => d.key === "preview-upstream")?.repoPairs).toEqual(pairs);
    expect(defs.find((d) => d.key === "ai-qa")?.repoPairs).toBeNull();
  });
});

describe("getChores — chore 10 request-reviews (manual only)", () => {
  it("never suggests request-reviews, even for an open PR short of approvals", async () => {
    const task = await seedTask();

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("continue-work");
    expect(keys).not.toContain("request-reviews");
  });

  it("lists request-reviews for the AI menu, bulk, in the main checkout", () => {
    const def = getChoreDefinitions().find((d) => d.key === "request-reviews");
    expect(def?.number).toBe(10);
    expect(def?.supportsBulk).toBe(true);
    expect(getChoreDefinition("request-reviews")?.cwd).toBe("main");
  });
});

describe("getChores — chore 15 hermetic-tests (between AI QA and self review)", () => {
  async function seedCodeReviewDraft(repo: string, choreSkips: string | null = null) {
    await db.insert(statusCategories).values([
      { name: "Code Review", color: "violet", done: 0, displayOrder: 1, jiraMappings: "[]" },
    ]);
    const [repository] = await db
      .insert(repositories)
      .values({ owner: "Hivebrite", repo, enabled: 1 })
      .returning();
    const [task] = await db
      .insert(tasks)
      .values({
        title: "Poll deletion",
        status: "Code Review",
        createdAt: NOW,
        updatedAt: NOW,
        prNumber: 42,
        repositoryId: repository.id,
        prState: "open",
        isDraft: 1,
        choreSkips,
      })
      .returning();
    return task;
  }

  beforeEach(() => {
    sqlite.exec("DELETE FROM repositories");
  });

  // Leave no Code Review-only category set behind for later test files.
  afterAll(() => {
    sqlite.exec("DELETE FROM tasks");
    sqlite.exec("DELETE FROM repositories");
    sqlite.exec("DELETE FROM status_categories");
    invalidateStatusConfigCache();
  });

  it("suggests hermetic-tests, not the self review, for an alumni_connect draft in Code Review", async () => {
    const task = await seedCodeReviewDraft("alumni_connect");

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("hermetic-tests");
    expect(keys).not.toContain("code-review-pr");
  });

  it("suggests the self review once hermetic-tests is done", async () => {
    const task = await seedCodeReviewDraft("alumni_connect", '{"hermetic-tests": true}');

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("code-review-pr");
    expect(keys).not.toContain("hermetic-tests");
  });

  it("never suggests hermetic-tests outside alumni_connect, nor holds back its self review", async () => {
    const task = await seedCodeReviewDraft("front-monorepo");

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).toContain("code-review-pr");
    expect(keys).not.toContain("hermetic-tests");
  });
});
