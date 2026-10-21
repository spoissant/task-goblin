import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks, statusCategories, repositories } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { autoPromptFor, fingerprintFor, getChoreDefinition, getChoreDefinitions, getChores, isAutoChore } from "./chores";
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

describe("getChores — chore 7 AI QA on a hivetests sub-task", () => {
  async function seedHivetestsSubtask(parentPrNumber: number | null) {
    await db.insert(statusCategories).values([
      { name: "In Progress", color: "blue", done: 0, displayOrder: 1, jiraMappings: "[]" },
      { name: "Done", color: "green", done: 1, displayOrder: 2, jiraMappings: "[]" },
    ]);
    const [ac, ht] = await db
      .insert(repositories)
      .values([
        { owner: "Hivebrite", repo: "alumni_connect", enabled: 1 },
        { owner: "Hivebrite", repo: "hivetests", enabled: 1 },
      ])
      .returning();
    const base = { status: "In Progress", createdAt: NOW, updatedAt: NOW };
    await db.insert(tasks).values({
      ...base,
      title: "Poll deletion",
      jiraKey: "EV-1",
      repositoryId: ac.id,
      prNumber: parentPrNumber,
      prState: parentPrNumber ? "open" : null,
      isDraft: parentPrNumber ? 1 : null,
    });
    const [subtask] = await db
      .insert(tasks)
      .values({
        ...base,
        title: "[hivetests] Hermetic specs for poll deletion",
        jiraKey: "EV-2",
        parentKey: "EV-1",
        repositoryId: ht.id,
        prNumber: 7,
        prState: "open",
        isDraft: 1,
      })
      .returning();
    return subtask;
  }

  beforeEach(() => {
    sqlite.exec("DELETE FROM repositories");
  });

  afterAll(() => {
    sqlite.exec("DELETE FROM tasks");
    sqlite.exec("DELETE FROM repositories");
  });

  it("waits while the alumni_connect parent has no PR", async () => {
    const subtask = await seedHivetestsSubtask(null);

    const keys = (await getChores({ taskId: subtask.id })).map((e) => e.key);

    expect(keys).not.toContain("ai-qa");
  });

  it("suggests AI QA once the parent has a PR", async () => {
    const subtask = await seedHivetestsSubtask(42);

    const keys = (await getChores({ taskId: subtask.id })).map((e) => e.key);

    expect(keys).toContain("ai-qa");
  });
});

describe("getChores — chores 4 and 5 on a merged PR", () => {
  it("no longer suggests fixing checks or comments once the PR is merged", async () => {
    const task = await seedTask();
    await db
      .update(tasks)
      .set({ prState: "merged", checksStatus: "failing", unresolvedCommentCount: 3 })
      .where(eq(tasks.id, task.id));

    const keys = (await getChores({ taskId: task.id })).map((e) => e.key);

    expect(keys).not.toContain("fix-pr-checks");
    expect(keys).not.toContain("address-pr-comments");
  });
});

describe("auto chores", () => {
  it("marks the chores the scheduler may start, never start-task or manual ones", () => {
    expect(isAutoChore("fix-pr-checks")).toBe(true);
    expect(isAutoChore("deploy-test-env")).toBe(true);
    expect(isAutoChore("start-task")).toBe(false);
    expect(isAutoChore("request-reviews")).toBe(false);
    expect(isAutoChore("nope")).toBe(false);
  });

  it("fingerprints a chore by its trigger fields, stable until they change", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ headSha: "abc123" }).where(eq(tasks.id, task.id));
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));

    expect(fingerprintFor("fix-pr-checks", row)).toBe(JSON.stringify(["abc123"]));
    expect(fingerprintFor("fix-pr-checks", row)).toBe(fingerprintFor("fix-pr-checks", { ...row, title: "renamed" }));
    expect(fingerprintFor("fix-pr-checks", { ...row, headSha: "def456" })).not.toBe(fingerprintFor("fix-pr-checks", row));
    expect(fingerprintFor("continue-work", row)).toBe(JSON.stringify(["In Progress", 0, "abc123", 0]));
    expect(fingerprintFor("start-task", row)).toBeNull();
    expect(fingerprintFor("request-reviews", row)).toBeNull();
  });

  it("deploys to staging by default and keeps the usual prompt elsewhere", async () => {
    const task = await seedTask();

    expect(autoPromptFor("deploy-test-env", task)).toBe(`/chore-deploy-to-test-env ${task.id} staging`);
    expect(autoPromptFor("fix-pr-checks", task)).toBe(`/chore-fix-pr-checks ${task.id}`);
    expect(autoPromptFor("start-task", task)).toBeNull();
  });
});
