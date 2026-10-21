import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { db, sqlite } from "../../db";
import { claudeSessions, repositories, statusCategories, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { listInbox } from "./inbox";

const NOW = "2026-10-21T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let repoId: number;

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(async () => {
  sqlite.exec("DELETE FROM claude_sessions");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM repositories");
  sqlite.exec("DELETE FROM status_categories");
  invalidateStatusConfigCache();
  await db.insert(statusCategories).values([
    { name: "Backlog", color: "gray", done: 0, displayOrder: 0, jiraMappings: JSON.stringify(["To Do"]) },
    { name: "In Progress", color: "blue", done: 0, displayOrder: 1, jiraMappings: "[]" },
    { name: "Ready to Merge", color: "green", done: 0, displayOrder: 5, jiraMappings: "[]" },
    { name: "Done", color: "green", done: 1, displayOrder: 6, jiraMappings: "[]" },
  ]);
  const [repo] = await db.insert(repositories).values({ owner: "hivebrite", repo: "alumni_connect" }).returning();
  repoId = repo.id;
});

type TaskValues = Partial<typeof tasks.$inferInsert>;
async function seedTask(values: TaskValues = {}) {
  const [task] = await db
    .insert(tasks)
    .values({ title: "A task", status: "In Progress", createdAt: NOW, updatedAt: NOW, repositoryId: repoId, ...values })
    .returning();
  return task;
}

type SessionValues = Partial<typeof claudeSessions.$inferInsert>;
async function seedSession(values: SessionValues = {}) {
  const at = values.updatedAt ?? NOW;
  const [session] = await db
    .insert(claudeSessions)
    .values({
      choreKey: "ai-qa",
      choreName: "AI QA",
      prompt: "/chore-ai-qa 1",
      cwd: "/tmp",
      name: "PS-1 · AI QA",
      state: "working",
      createdAt: at,
      updatedAt: at,
      ...values,
    })
    .returning();
  return session;
}

describe("listInbox — blocked sessions", () => {
  it("lists a blocked session with its question, claude.ai link and task", async () => {
    const task = await seedTask({ jiraKey: "PS-1" });
    await seedSession({ taskId: task.id, state: "blocked", needs: "Which env?", bridgeSessionId: "cse_abc", shortId: "k7" });

    const items = await listInbox();

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.kind).toBe("blocked");
    if (item.kind !== "blocked") return;
    expect(item.session.needs).toBe("Which env?");
    expect(item.session.link).toBe("https://claude.ai/code/session_abc");
    expect(item.session.shortId).toBe("k7");
    expect(item.task?.jiraKey).toBe("PS-1");
    expect(item.task?.repository).toEqual({ owner: "hivebrite", repo: "alumni_connect" });
  });

  it("keeps a task-less PR review session, with a null task", async () => {
    await seedSession({ state: "blocked", prUrl: "https://github.com/hivebrite/alumni_connect/pull/9", choreKey: "review-pr" });

    const [item] = await listInbox();

    expect(item.kind).toBe("blocked");
    if (item.kind === "blocked") expect(item.task).toBeNull();
  });
});

describe("listInbox — failed sessions", () => {
  it("lists only the latest session per task and chore, within 7 days", async () => {
    const task = await seedTask();
    await seedSession({ taskId: task.id, state: "failed", error: "old", updatedAt: ago(2 * HOUR) });
    await seedSession({ taskId: task.id, state: "failed", error: "latest", updatedAt: ago(1 * HOUR) });
    await seedSession({ taskId: task.id, state: "failed", choreKey: "fix-pr-checks", updatedAt: ago(8 * 24 * HOUR) });

    const failed = (await listInbox()).filter((i) => i.kind === "failed");

    expect(failed).toHaveLength(1);
    if (failed[0].kind === "failed") expect(failed[0].session.error).toBe("latest");
  });

  it("hides a failure once a newer session ran the same chore on the task", async () => {
    const task = await seedTask();
    await seedSession({ taskId: task.id, state: "failed", updatedAt: ago(2 * HOUR) });
    await seedSession({ taskId: task.id, state: "done", updatedAt: ago(1 * HOUR) });

    expect((await listInbox()).filter((i) => i.kind === "failed")).toHaveLength(0);
  });
});

describe("listInbox — merge holds", () => {
  const readyToMerge: TaskValues = { status: "Ready to Merge", prState: "open", prNumber: 42 };

  it("lists an actionable hold with its reasons and PR link", async () => {
    const hold = { reasons: ["awaiting-approval", "conflicts"], at: NOW };
    const task = await seedTask({ ...readyToMerge, mergeHold: JSON.stringify(hold) });

    const [item] = await listInbox();

    expect(item.kind).toBe("merge-hold");
    if (item.kind !== "merge-hold") return;
    expect(item.task.id).toBe(task.id);
    expect(item.reasons).toEqual(["conflicts"]);
    expect(item.prUrl).toBe("https://github.com/hivebrite/alumni_connect/pull/42");
    expect(item.at).toBe(NOW);
  });

  it("hides holds that clear on their own and PRs that left Ready to Merge or closed", async () => {
    const waiting = JSON.stringify({ reasons: ["awaiting-approval", "checks-pending"], at: NOW });
    const actionable = JSON.stringify({ reasons: ["checks-failing"], at: NOW });
    await seedTask({ ...readyToMerge, mergeHold: waiting });
    await seedTask({ ...readyToMerge, status: "In Progress", mergeHold: actionable });
    await seedTask({ ...readyToMerge, prState: "merged", mergeHold: actionable });

    expect(await listInbox()).toHaveLength(0);
  });
});

describe("listInbox — sprint build red", () => {
  const red: TaskValues = { status: "Done", prState: "merged", prNumber: 7, baseBuildState: "failed", baseBuildUrl: "https://buildkite.com/b/1" };

  it("lists a red build with its sprint-red session", async () => {
    const task = await seedTask({ ...red, mergeVerifiedAt: "2026-10-21T13:00:00.000Z" });
    await seedSession({ taskId: task.id, choreKey: "sprint-red", choreName: "Sprint Build Red", state: "working" });

    const [item] = await listInbox();

    expect(item.kind).toBe("sprint-red");
    if (item.kind !== "sprint-red") return;
    expect(item.buildUrl).toBe("https://buildkite.com/b/1");
    expect(item.session?.choreKey).toBe("sprint-red");
    expect(item.at).toBe("2026-10-21T13:00:00.000Z");
  });

  it("stays without a session, and leaves once the session has been done for a day", async () => {
    await seedTask(red);
    const resolved = await seedTask(red);
    await seedSession({ taskId: resolved.id, choreKey: "sprint-red", state: "done", updatedAt: ago(25 * HOUR) });
    const fresh = await seedTask(red);
    await seedSession({ taskId: fresh.id, choreKey: "sprint-red", state: "done", updatedAt: ago(1 * HOUR) });

    const ids = (await listInbox()).flatMap((i) => (i.kind === "sprint-red" ? [i.task.id] : []));

    expect(ids).toHaveLength(2);
    expect(ids).toContain(fresh.id);
    expect(ids).not.toContain(resolved.id);
  });
});

describe("listInbox — ready to start", () => {
  it("lists Backlog tasks with a repository and no PR", async () => {
    const task = await seedTask({ status: "To Do", jiraKey: "PS-9" });
    await seedTask({ status: "Backlog", repositoryId: null });
    await seedTask({ status: "Backlog", prNumber: 3, prState: "open" });
    await seedTask({ status: "Backlog", onIce: 1 });

    const items = await listInbox();

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("ready-to-start");
    if (items[0].kind === "ready-to-start") expect(items[0].task.id).toBe(task.id);
  });

  it("hides a task once a session is queued, working or blocked on it", async () => {
    const task = await seedTask({ status: "Backlog" });
    await seedSession({ taskId: task.id, choreKey: "start-task", state: "queued" });

    expect((await listInbox()).filter((i) => i.kind === "ready-to-start")).toHaveLength(0);
  });

  it("shows it again after that session ended", async () => {
    const task = await seedTask({ status: "Backlog" });
    await seedSession({ taskId: task.id, choreKey: "start-task", state: "stopped" });

    expect((await listInbox()).filter((i) => i.kind === "ready-to-start")).toHaveLength(1);
  });
});

describe("listInbox — ordering", () => {
  it("sorts every kind together, newest first", async () => {
    const older = await seedTask({ status: "Backlog", updatedAt: "2026-10-20T00:00:00.000Z" });
    const blockedTask = await seedTask();
    await seedSession({ taskId: blockedTask.id, state: "blocked", updatedAt: "2026-10-21T00:00:00.000Z" });
    const hold = JSON.stringify({ reasons: ["conflicts"], at: "2026-10-22T00:00:00.000Z" });
    await seedTask({ status: "Ready to Merge", prState: "open", prNumber: 1, mergeHold: hold });

    const kinds = (await listInbox()).map((i) => i.kind);

    expect(kinds).toEqual(["merge-hold", "blocked", "ready-to-start"]);
    expect(older.id).toBeGreaterThan(0);
  });
});
