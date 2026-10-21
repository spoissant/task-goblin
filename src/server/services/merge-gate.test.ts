import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { repositories, statusCategories, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { resetBuildkiteFetch, setBuildkiteFetch } from "../lib/buildkite-client";
import { parseMergeHold, type HoldReason } from "@/shared/merge";
import { actionsHealth, evaluateTaskGate, findPrereleasePins, runMergeGate } from "./merge-gate";
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
    jiraSyncedAt: null,
    highPriority: 0,
    onIce: 0,
    onIceReason: null,
    prNumber: 10,
    repositoryId: 1,
    headBranch: "fix/EV-1",
    baseBranch: "sprint",
    prState: "open",
    prAuthor: null,
    isDraft: 0,
    checksStatus: "passing",
    checksDetails: null,
    approvedReviewCount: 1,
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
    workingOn: null,
    headSha: "head1",
    mergeCommitSha: null,
    autoMergeEnabledAt: null,
    mergeHold: null,
    baseBuildState: null,
    baseBuildUrl: null,
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

  it("matches the status case-insensitively and with underscores", () => {
    expect(evaluateTaskGate(greenTask({ status: "ready_to_merge" }), READY)).toEqual([]);
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

describe("actionsHealth", () => {
  const run = (conclusion: string | null, status = "completed", name = "CI") => ({ name, status, conclusion, headSha: "s", htmlUrl: "u" });

  it("reads only the CI workflow", () => {
    expect(actionsHealth([run("failure", "completed", "Release")])).toBe("unknown");
    expect(actionsHealth([run("success"), run("failure", "completed", "Lint")])).toBe("green");
  });

  it("is red on a failure, pending while running, green when all succeeded", () => {
    expect(actionsHealth([run("success"), run("timed_out")])).toBe("red");
    expect(actionsHealth([run(null, "in_progress")])).toBe("pending");
    expect(actionsHealth([run("success"), run("success")])).toBe("green");
    expect(actionsHealth([run("cancelled")])).toBe("unknown");
  });
});

describe("runMergeGate", () => {
  const calls: string[] = [];
  let files: PullFile[] = [];
  let buildkiteState = "passed";

  const stub: MergeGitHub = {
    async enableAutoMerge(t) {
      calls.push(`enable ${t.repo}#${t.number}`);
      return "enabled";
    },
    async disableAutoMerge(t) {
      calls.push(`disable ${t.repo}#${t.number}`);
    },
    async listPullFiles() {
      calls.push("files");
      return files;
    },
    async latestBaseRuns(_o, repo) {
      calls.push(`runs ${repo}`);
      return [{ name: "CI", status: "completed", conclusion: "success", headSha: "m", htmlUrl: "u" }];
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
    buildkiteState = "passed";
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
    ]);
    process.env.BUILDKITE_API_TOKEN = "bk";
    setBuildkiteFetch(async (input) => {
      calls.push(`buildkite ${new URL(String(input)).searchParams.get("branch")}`);
      return new Response(JSON.stringify([{ number: 1, state: buildkiteState, commit: "c", web_url: "w", finished_at: null }]));
    });
    setMergeGitHub(stub);
  });

  afterEach(() => {
    resetMergeGitHub();
    resetBuildkiteFetch();
    delete process.env.BUILDKITE_API_TOKEN;
  });

  async function insert(over: Partial<TaskRow> = {}): Promise<number> {
    const { id: _id, ...row } = greenTask(over);
    const [inserted] = await db.insert(tasks).values(row).returning({ id: tasks.id });
    return inserted.id;
  }

  const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

  it("enables auto-merge once and stamps the task; the next tick re-checks only pins", async () => {
    const id = await insert();

    await runMergeGate();

    expect(calls).toEqual(["buildkite sprint", "files", "enable alumni_connect#10"]);
    const after = await load(id);
    expect(after.autoMergeEnabledAt).not.toBeNull();
    expect(after.mergeHold).toBeNull();

    calls.length = 0;
    await runMergeGate();
    expect(calls).toEqual(["files"]);
    expect((await load(id)).autoMergeEnabledAt).toBe(after.autoMergeEnabledAt);
  });

  it("stamps the task when GitHub says auto-merge was already on", async () => {
    setMergeGitHub({ ...stub, enableAutoMerge: async () => "already" });
    const id = await insert();

    await runMergeGate();

    expect((await load(id)).autoMergeEnabledAt).not.toBeNull();
  });

  it("records a hold instead of enabling, updates it when the reasons change, and clears it once green", async () => {
    const id = await insert({ checksStatus: "pending" });

    await runMergeGate();
    expect(calls).toEqual([]);
    const first = parseMergeHold((await load(id)).mergeHold);
    expect(first?.reasons).toEqual(["checks-pending"]);

    await runMergeGate();
    expect((await load(id)).mergeHold).toBe(JSON.stringify(first)); // unchanged reasons: no rewrite

    await db.update(tasks).set({ checksStatus: "failing", hasConflicts: 1 }).where(eq(tasks.id, id));
    await runMergeGate();
    expect(parseMergeHold((await load(id)).mergeHold)?.reasons).toEqual(["checks-failing", "conflicts"]);

    await db.update(tasks).set({ checksStatus: "passing", hasConflicts: 0 }).where(eq(tasks.id, id));
    await runMergeGate();
    const done = await load(id);
    expect(done.mergeHold).toBeNull();
    expect(done.autoMergeEnabledAt).not.toBeNull();
  });

  it("holds on a red or unknown base branch and never calls GitHub for it", async () => {
    buildkiteState = "failed";
    const red = await insert();
    await runMergeGate();
    expect(parseMergeHold((await load(red)).mergeHold)?.reasons).toEqual(["base-ci-red"]);
    expect(calls).not.toContain("enable alumni_connect#10");

    delete process.env.BUILDKITE_API_TOKEN;
    await db.update(tasks).set({ mergeHold: null }).where(eq(tasks.id, red));
    await runMergeGate();
    expect(parseMergeHold((await load(red)).mergeHold)?.reasons).toEqual(["base-ci-unknown"]);
  });

  it("checks the base branch once per repository per tick, via Actions for non-Buildkite repos", async () => {
    await insert({ repositoryId: 2, prNumber: 20 });
    await insert({ repositoryId: 2, prNumber: 21, jiraKey: "EV-2" });

    await runMergeGate();

    expect(calls.filter((c) => c === "runs front-monorepo")).toHaveLength(1);
    expect(calls).toContain("enable front-monorepo#20");
    expect(calls).toContain("enable front-monorepo#21");
  });

  it("holds on a prerelease pin", async () => {
    files = [{ filename: "package.json", patch: '+    "@hivebrite/ui": "1.0.0-spoissant-alpha.2",' }];
    const id = await insert();

    await runMergeGate();

    expect(parseMergeHold((await load(id)).mergeHold)?.reasons).toEqual(["prerelease-pin"]);
    expect(calls).not.toContain("enable alumni_connect#10");
  });

  it("leaves tasks outside Ready to Merge, on ice, or without a PR untouched", async () => {
    const review = await insert({ status: "Code Review" });
    const ice = await insert({ onIce: 1, jiraKey: "EV-2" });
    const noPr = await insert({ prNumber: null, prState: null, jiraKey: "EV-3" });

    await runMergeGate();

    expect(calls).toEqual([]);
    for (const id of [review, ice, noPr]) {
      const row = await load(id);
      expect(row.autoMergeEnabledAt).toBeNull();
      expect(row.mergeHold).toBeNull();
    }
  });

  it("clears a stale hold when the task leaves Ready to Merge", async () => {
    const id = await insert({ status: "Code Review", mergeHold: JSON.stringify({ reasons: ["checks-pending"], at: NOW }) });

    await runMergeGate();

    expect((await load(id)).mergeHold).toBeNull();
  });

  it("disables auto-merge when a pin lands after enabling", async () => {
    const id = await insert({ autoMergeEnabledAt: NOW });
    files = [{ filename: "Gemfile", patch: '+gem "dto", github: "Hivebrite/dto-ruby", ref: "abc123def"' }];

    await runMergeGate();

    expect(calls).toEqual(["files", "disable alumni_connect#10"]);
    const row = await load(id);
    expect(row.autoMergeEnabledAt).toBeNull();
    expect(parseMergeHold(row.mergeHold)?.reasons).toEqual(["prerelease-pin"]);
  });

  it("disables auto-merge when the task leaves Ready to Merge", async () => {
    const id = await insert({ autoMergeEnabledAt: NOW, status: "Code Review" });

    await runMergeGate();

    expect(calls).toEqual(["disable alumni_connect#10"]);
    const row = await load(id);
    expect(row.autoMergeEnabledAt).toBeNull();
    expect(parseMergeHold(row.mergeHold)?.reasons).toEqual(["not-ready-to-merge"]);
  });

  it("keeps going when one task's GitHub call fails", async () => {
    setMergeGitHub({
      ...stub,
      async enableAutoMerge(t) {
        if (t.number === 10) throw new Error("boom");
        calls.push(`enable ${t.repo}#${t.number}`);
        return "enabled";
      },
    });
    const failing = await insert();
    const fine = await insert({ prNumber: 11, jiraKey: "EV-2" });

    await runMergeGate();

    expect((await load(failing)).autoMergeEnabledAt).toBeNull();
    expect((await load(fine)).autoMergeEnabledAt).not.toBeNull();
  });
});
