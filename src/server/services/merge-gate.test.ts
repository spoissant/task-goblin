import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { repositories, statusCategories, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { invalidateStatusConfigCache } from "../lib/task-status";
import type { HoldReason } from "@/shared/merge";
import { evaluateTaskGate, findPrereleasePins, mergeTaskPr, runMergeGate } from "./merge-gate";
import { resetMergeGitHub, setMergeGitHub, type MergeGitHub, type PullFile } from "./merge-github";

type TaskRow = typeof tasks.$inferSelect;
const NOW = "2026-10-21T00:00:00.000Z";
const READY = new Set(["ready to merge"]);
const APPROVED = JSON.stringify({ decision: "APPROVED", approvedCount: 1, requiredApprovals: 1, missingCodeOwners: [], optionalCodeOwners: [], changesRequestedBy: [], baseBranch: "sprint" });

/** A task row that passes every row-level gate; override to break one. */
function greenTask(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1,
    title: "t",
    description: null,
    status: "Ready to Merge",
    createdAt: NOW,
    updatedAt: NOW,
    jiraKey: "EV-1",
    type: null,
    assignee: null,
    priority: null,
    sprint: null,
    epicKey: null,
    parentKey: null,
    highPriority: 0,
    onIce: 0,
    onIceReason: null,
    prNumber: 10,
    repositoryId: 1,
    headBranch: "fix/EV-1",
    baseBranch: "sprint",
    prState: "open",
    isDraft: 0,
    checksStatus: "passing",
    checksDetails: null,
    reviewStatus: APPROVED,
    prSyncedAt: NOW,
    onDeploymentBranches: null,
    labelOnlyDeploymentBranches: null,
    deployedOnBranches: null,
    unresolvedCommentCount: 0,
    hasConflicts: 0,
    changedFiles: null,
    additions: null,
    deletions: null,
    changesByCategory: null,
    uncommittedFiles: null,
    unpushedCommits: null,
    choreSkips: null,
    headSha: "head1",
    mergeCommitSha: null,
    mergeReady: 0,
    mergeVerifiedAt: null,
    ...over,
  } as TaskRow;
}

describe("evaluateTaskGate", () => {
  it("passes a Ready to Merge PR that is approved, green, clean and resolved", () => {
    expect(evaluateTaskGate(greenTask(), READY)).toEqual([]);
  });

  const cases: Array<[string, Partial<TaskRow>, HoldReason]> = [
    ["status outside the category", { status: "Code Review" }, "not-ready-to-merge"],
    ["draft", { isDraft: 1 }, "draft"],
    ["changes requested", { reviewStatus: JSON.stringify({ decision: "CHANGES_REQUESTED", changesRequestedBy: ["bob"] }) }, "changes-requested"],
    ["review required", { reviewStatus: JSON.stringify({ decision: "REVIEW_REQUIRED" }) }, "awaiting-approval"],
    ["no review status synced", { reviewStatus: null }, "awaiting-approval"],
    ["checks pending", { checksStatus: "pending" }, "checks-pending"],
    ["checks unknown", { checksStatus: null }, "checks-pending"],
    ["checks failing", { checksStatus: "failing" }, "checks-failing"],
    ["conflicts", { hasConflicts: 1 }, "conflicts"],
    ["unresolved comments", { unresolvedCommentCount: 2 }, "unresolved-comments"],
  ];
  for (const [name, over, reason] of cases) {
    it(`holds on ${name}`, () => {
      expect(evaluateTaskGate(greenTask(over), READY)).toEqual([reason]);
    });
  }

  it("matches the status case-insensitively", () => {
    expect(evaluateTaskGate(greenTask({ status: "READY TO MERGE" }), READY)).toEqual([]);
  });

  it("lists every hold at once", () => {
    const reasons = evaluateTaskGate(greenTask({ isDraft: 1, checksStatus: "failing", hasConflicts: 1 }), READY);
    expect(reasons).toEqual(["draft", "checks-failing", "conflicts"]);
  });
});

describe("findPrereleasePins", () => {
  const file = (filename: string, patch: string): PullFile => ({ filename, patch });

  it("reports only added lines, not removed or context ones", () => {
    const patch = ['@@ -1,3 +1,3 @@', '-    "@hivebrite/ui": "1.0.0-spoissant-alpha.1",', '+    "@hivebrite/ui": "1.0.0",', '     "react": "18"'].join("\n");
    expect(findPrereleasePins([file("package.json", patch)])).toEqual([]);
  });

  it("flags an alpha version", () => {
    const patch = '+++ b/package.json\n+    "@hivebrite/ui": "1.2.3-spoissant-alpha.4",';
    expect(findPrereleasePins([file("package.json", patch)])).toEqual(['package.json: "@hivebrite/ui": "1.2.3-spoissant-alpha.4",']);
  });

  it("flags a user-suffixed prerelease and a git ref in nested manifests", () => {
    const files = [
      file("apps/web/package.json", '+    "@hivebrite/sdk": "2.0.0-spoissant.1",'),
      file("yarn.lock", '+  resolved "github:Hivebrite/front-monorepo#feat/x"'),
    ];
    expect(findPrereleasePins(files)).toEqual([
      'apps/web/package.json: "@hivebrite/sdk": "2.0.0-spoissant.1",',
      'yarn.lock: resolved "github:Hivebrite/front-monorepo#feat/x"',
    ]);
  });

  it("flags a Gemfile SDK gem pinned to a sha or branch but not to a tag", () => {
    const pinned = file("Gemfile", '+gem "dto", github: "Hivebrite/protobuf-dto-ruby", ref: "d9dabdf3cdff"');
    const tagged = file("Gemfile", '+gem "openapi_sdk", github: "Hivebrite/openapi-ruby-sdk", tag: "v1.49.1"');
    const branch = file("Gemfile.lock", '+  branch: feat/x');
    expect(findPrereleasePins([pinned])).toHaveLength(1);
    expect(findPrereleasePins([tagged])).toEqual([]);
    expect(findPrereleasePins([branch])).toEqual([]); // lock lines carry no quotes; the Gemfile is the pin
  });

  it("ignores files that are not dependency manifests and files without a patch", () => {
    const files = [file("src/app.ts", '+const v = "1.0.0-alpha.1";'), { filename: "package.json", patch: null }];
    expect(findPrereleasePins(files)).toEqual([]);
  });

  it("ignores a stable @hivebrite version", () => {
    expect(findPrereleasePins([file("package.json", '+    "@hivebrite/ui": "^3.4.0",')])).toEqual([]);
  });
});

describe("runMergeGate", () => {
  const calls: string[] = [];
  let files: PullFile[] = [];

  const stub: MergeGitHub = {
    async mergePr(t) {
      calls.push(`merge ${t.repo}#${t.number}`);
      return { sha: "squash-sha" };
    },
    async listPullFiles() {
      calls.push("files");
      return files;
    },
    async runsForSha() {
      return [];
    },
    async prLabels() {
      return [];
    },
    async openReleasePrs() {
      return [];
    },
    async approvePr() {},
  };

  beforeAll(() => {
    createTestTables(sqlite);
  });

  beforeEach(async () => {
    calls.length = 0;
    files = [];
    sqlite.exec("DELETE FROM tasks");
    sqlite.exec("DELETE FROM repositories");
    sqlite.exec("DELETE FROM status_categories");
    invalidateStatusConfigCache();
    await db.insert(statusCategories).values([
      { name: "Code Review", color: "y", done: 0, displayOrder: 1, jiraMappings: "[]" },
      { name: "Ready to Merge", color: "g", done: 0, displayOrder: 2, jiraMappings: JSON.stringify(["Ready to Merge"]) },
    ]);
    await db.insert(repositories).values([
      { id: 1, owner: "Hivebrite", repo: "alumni_connect", enabled: 1, defaultBaseBranch: "sprint" },
      { id: 2, owner: "Hivebrite", repo: "front-monorepo", enabled: 1, defaultBaseBranch: "main" },
      { id: 3, owner: "Hivebrite", repo: "hivetests", enabled: 1, defaultBaseBranch: "main" },
    ]);
    setMergeGitHub(stub);
  });

  afterEach(() => {
    resetMergeGitHub();
  });

  async function insert(over: Partial<TaskRow> = {}): Promise<number> {
    const { id: _id, ...row } = greenTask(over);
    const [inserted] = await db.insert(tasks).values(row).returning({ id: tasks.id });
    return inserted.id;
  }

  const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

  it("marks a PR that passes every gate as ready without merging it, and rewrites nothing on the next pass", async () => {
    const id = await insert();

    await runMergeGate();

    expect(calls).toEqual(["files"]);
    const row = await load(id);
    expect(row.mergeReady).toBe(1);
    expect(row.prState).toBe("open");

    await runMergeGate();
    expect((await load(id)).updatedAt).toBe(row.updatedAt);
  });

  it("keeps a held PR unready, then marks it ready once green", async () => {
    const id = await insert({ checksStatus: "pending" });

    await runMergeGate();
    expect(calls).toEqual([]);
    const held = await load(id);
    expect(held.mergeReady).toBe(0);
    expect(held.updatedAt).toBe(NOW); // the verdict didn't change: no write

    await db.update(tasks).set({ checksStatus: "failing", hasConflicts: 1 }).where(eq(tasks.id, id));
    await runMergeGate();
    expect((await load(id)).mergeReady).toBe(0);

    await db.update(tasks).set({ checksStatus: "passing", hasConflicts: 0 }).where(eq(tasks.id, id));
    await runMergeGate();
    expect((await load(id)).mergeReady).toBe(1);
    expect(calls).not.toContain("merge alumni_connect#10");
  });

  it("holds on a prerelease pin", async () => {
    files = [{ filename: "package.json", patch: '+    "@hivebrite/ui": "1.0.0-spoissant-alpha.2",' }];
    const id = await insert();

    await runMergeGate();

    expect((await load(id)).mergeReady).toBe(0);
    expect(calls).not.toContain("merge alumni_connect#10");
  });

  it("holds a hivetests PR whose branch an alumni_connect task has, whatever that task's state", async () => {
    const paired = await insert({ repositoryId: 3, prNumber: 30, headBranch: "feat/EV-1", jiraKey: "EV-2" });
    await insert({ status: "Done", prState: "merged", headBranch: "feat/EV-1" });
    const alone = await insert({ repositoryId: 3, prNumber: 31, headBranch: "feat/EV-9", jiraKey: "EV-3" });
    await insert({ repositoryId: 2, prNumber: 20, headBranch: "feat/EV-9", jiraKey: "EV-4", status: "Code Review" });

    await runMergeGate();

    expect((await load(paired)).mergeReady).toBe(0);
    expect((await load(alone)).mergeReady).toBe(1);
    await expect(mergeTaskPr(paired)).rejects.toMatchObject({ code: "MERGE_HELD", message: "Not ready to merge: alumni-connect-branch" });
    expect(calls).not.toContain("merge hivetests#30");
  });

  it("leaves tasks outside Ready to Merge, on ice, or without a PR untouched", async () => {
    const review = await insert({ status: "Code Review" });
    const ice = await insert({ onIce: 1, jiraKey: "EV-2" });
    const noPr = await insert({ prNumber: null, prState: null, jiraKey: "EV-3" });

    await runMergeGate();

    expect(calls).toEqual([]);
    for (const id of [review, ice, noPr]) {
      const row = await load(id);
      expect(row.mergeReady).toBe(0);
      expect(row.updatedAt).toBe(NOW);
    }
  });

  it("clears a stale ready mark when the task leaves Ready to Merge or its PR closes", async () => {
    const review = await insert({ status: "Code Review", mergeReady: 1 });
    const closed = await insert({ prState: "closed", jiraKey: "EV-2", mergeReady: 1 });

    await runMergeGate();

    expect(calls).toEqual([]);
    expect((await load(review)).mergeReady).toBe(0);
    expect((await load(closed)).mergeReady).toBe(0);
  });

  it("keeps going when one task's GitHub call fails", async () => {
    setMergeGitHub({
      ...stub,
      async listPullFiles(t) {
        if (t.number === 10) throw new Error("boom");
        return [];
      },
    });
    const failing = await insert();
    const fine = await insert({ prNumber: 11, jiraKey: "EV-2" });

    await runMergeGate();

    expect((await load(failing)).mergeReady).toBe(0);
    expect((await load(fine)).mergeReady).toBe(1);
  });

  describe("mergeTaskPr", () => {
    it("squash-merges a PR that passes every gate and marks the task merged for the watch", async () => {
      const id = await insert({ mergeReady: 1 });

      const task = await mergeTaskPr(id);

      expect(calls).toEqual(["files", "merge alumni_connect#10"]);
      const row = await load(id);
      expect(row.prState).toBe("merged");
      expect(row.mergeCommitSha).toBe("squash-sha");
      expect(row.mergeReady).toBe(0);
      expect(task).toMatchObject({ prState: "merged", mergeCommitSha: "squash-sha", mergeReady: 0 });
    });

    it("refuses with the holds when the task no longer passes, and clears its ready mark", async () => {
      const id = await insert({ checksStatus: "failing", hasConflicts: 1, mergeReady: 1 });

      await expect(mergeTaskPr(id)).rejects.toMatchObject({
        statusCode: 409,
        code: "MERGE_HELD",
        message: "Not ready to merge: checks-failing, conflicts",
      });

      expect(calls).toEqual([]);
      expect((await load(id)).mergeReady).toBe(0);
    });

    it("refuses a prerelease pin", async () => {
      files = [{ filename: "package.json", patch: '+    "@hivebrite/ui": "github:Hivebrite/ui#feat"' }];
      const id = await insert({ mergeReady: 1 });

      await expect(mergeTaskPr(id)).rejects.toMatchObject({ code: "MERGE_HELD" });
      expect(calls).not.toContain("merge alumni_connect#10");
      expect((await load(id)).mergeReady).toBe(0);
    });

    it("leaves the task open when GitHub refuses the merge", async () => {
      setMergeGitHub({ ...stub, mergePr: async () => { throw new Error("Required status check is expected"); } });
      const id = await insert({ mergeReady: 1 });

      await expect(mergeTaskPr(id)).rejects.toThrow(/Required status check/);
      const row = await load(id);
      expect(row.prState).toBe("open");
      expect(row.mergeReady).toBe(1);
    });

    it("refuses a task without an open PR and an unknown task", async () => {
      const id = await insert({ prState: "merged" });

      await expect(mergeTaskPr(id)).rejects.toMatchObject({ statusCode: 400, code: "NO_OPEN_PR" });
      await expect(mergeTaskPr(9999)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
