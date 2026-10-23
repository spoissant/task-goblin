import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { invalidateStatusConfigCache } from "../lib/task-status";
import type { PrTaskData } from "./github-mappers";
import { upsertPrTask } from "./github-upsert";

const NOW = "2026-10-22T00:00:00.000Z";
const ALUMNI_CONNECT = 1;
const HIVETESTS = 10;

/** PR #377 of hivetests as GitHub returns it; override to vary. */
function pr(over: Partial<PrTaskData> = {}): PrTaskData {
  return {
    prNumber: 377,
    repositoryId: HIVETESTS,
    title: "fix(news): drive the DatePicker V2 field [EV-3897]",
    prState: "open",
    headBranch: "fix/EV-3897",
    baseBranch: "main",
    headSha: "head1",
    mergeCommitSha: null,
    isDraft: 0,
    checksStatus: "passing",
    checksDetails: null,
    reviewStatus: "{}",
    unresolvedCommentCount: 0,
    hasConflicts: 0,
    changedFiles: 3,
    additions: 10,
    deletions: 2,
    changesByCategory: null,
    prSyncedAt: NOW,
    onDeploymentBranches: null,
    labelOnlyDeploymentBranches: null,
    deployedOnBranches: null,
    ...over,
  };
}

async function insertJiraTask(jiraKey: string, over: Partial<typeof tasks.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(tasks)
    .values({ title: `${jiraKey} summary`, status: "In Progress", createdAt: NOW, updatedAt: NOW, jiraKey, ...over })
    .returning({ id: tasks.id });
  return row.id;
}

const all = () => db.select().from(tasks).orderBy(asc(tasks.id));
const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(() => {
  for (const t of ["tasks", "repositories", "status_categories"]) sqlite.run(`DELETE FROM ${t}`);
  sqlite.run(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1), (10, 'hb', 'hivetests', 1)`);
  sqlite.run(`INSERT INTO status_categories (name, color, done, display_order, jira_mappings)
    VALUES ('In Progress', 'blue', 0, 1, '[]'), ('Code Review', 'yellow', 0, 2, '[]'), ('Done', 'green', 1, 3, '[]')`);
  invalidateStatusConfigCache();
});

describe("upsertPrTask", () => {
  it("makes a PR naming no known Jira task a PR-only task", async () => {
    expect(await upsertPrTask(pr())).toBe("new");

    const [task] = await all();
    expect(task).toMatchObject({ jiraKey: null, prNumber: 377, title: pr().title, status: "Code Review", headSha: "head1" });
  });

  it("merges the PR-only task created before its Jira task into it on the next sync", async () => {
    await upsertPrTask(pr());
    const [orphan] = await all();
    const jiraId = await insertJiraTask("EV-3897");

    expect(await upsertPrTask(pr({ headSha: "head2" }))).toBe("updated");

    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: jiraId, jiraKey: "EV-3897", title: "EV-3897 summary", prNumber: 377, headSha: "head2" });
    expect(await load(orphan.id)).toBeUndefined();
  });

  it("merges a PR-only task into the Jira task when both already hold the PR", async () => {
    await upsertPrTask(pr());
    const jiraId = await insertJiraTask("EV-3897", { repositoryId: HIVETESTS, prNumber: 377, prState: "open" });

    await upsertPrTask(pr());

    expect((await all()).map((t) => t.id)).toEqual([jiraId]);
  });

  it("links every Jira task a multi-key title tags", async () => {
    const first = await insertJiraTask("PS-1");
    const second = await insertJiraTask("PS-2");

    expect(await upsertPrTask(pr({ repositoryId: ALUMNI_CONNECT, title: "fix(groups): log in button [PS-1] [PS-2]", headBranch: "fix/PS-1" }))).toBe("updated");

    const rows = await all();
    expect(rows.map((t) => [t.id, t.prNumber, t.repositoryId])).toEqual([
      [first, 377, ALUMNI_CONNECT],
      [second, 377, ALUMNI_CONNECT],
    ]);
  });

  it("keeps a hivetests PR off the alumni_connect parent its branch is named after", async () => {
    const parent = await insertJiraTask("EV-1", { repositoryId: ALUMNI_CONNECT });
    const subtask = await insertJiraTask("EV-2");

    await upsertPrTask(pr({ prNumber: 7, title: "test(polls): delete a poll [EV-2]", headBranch: "feat/EV-1" }));
    await upsertPrTask(pr({ prNumber: 8, title: "test(polls): untagged", headBranch: "feat/EV-1" }));

    expect((await load(parent)).prNumber).toBeNull();
    expect((await load(subtask)).prNumber).toBe(7);
    expect((await all()).filter((t) => t.prNumber === 8).map((t) => t.jiraKey)).toEqual([null]);
  });

  it("links the open ticket without a PR its branch is named after when the title tags none", async () => {
    const done = await insertJiraTask("EV-6", { status: "Done" });
    const open = await insertJiraTask("EV-5");

    await upsertPrTask(pr({ prNumber: 5, title: "fix polls", headBranch: "spoissant/ev-5-polls" }));
    await upsertPrTask(pr({ prNumber: 6, title: "fix polls again", headBranch: "fix/EV-6" }));

    expect((await load(open)).prNumber).toBe(5);
    expect((await load(done)).prNumber).toBeNull();
    expect((await all()).filter((t) => t.prNumber === 6).map((t) => t.jiraKey)).toEqual([null]);
  });

  it("refreshes every PR column of a task found by number, keeping a Jira task's title and status", async () => {
    const id = await insertJiraTask("EV-3897");
    await upsertPrTask(pr());

    await upsertPrTask(pr({ title: "renamed", labelOnlyDeploymentBranches: '["staging"]', hasConflicts: 1, mergeCommitSha: "m1" }));

    expect(await load(id)).toMatchObject({
      title: "EV-3897 summary",
      status: "In Progress",
      labelOnlyDeploymentBranches: '["staging"]',
      hasConflicts: 1,
      mergeCommitSha: "m1",
    });
  });

  it("moves a PR-only task's status with its PR's state, keeping one set by hand until the state changes", async () => {
    await upsertPrTask(pr({ title: "no tag" }));
    const [task] = await all();
    await db.update(tasks).set({ status: "In Progress" }).where(eq(tasks.id, task.id));

    await upsertPrTask(pr({ title: "no tag, renamed" }));
    expect(await load(task.id)).toMatchObject({ status: "In Progress", title: "no tag, renamed" });

    await upsertPrTask(pr({ title: "no tag, renamed", prState: "merged" }));
    expect((await load(task.id)).status).toBe("Done");
  });
});
