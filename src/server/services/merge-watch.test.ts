import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import { resetBuildkiteFetch, setBuildkiteFetch } from "../lib/buildkite-client";
import { setCapacityCheck } from "./claude-sessions";
import { actionsBuildState, approveReleasePrs, publishProject, runMergeWatch } from "./merge-watch";
import { resetMergeGitHub, setMergeGitHub, type ActionsRun, type MergeGitHub, type ReleasePr } from "./merge-github";

const ok = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
const MAIN_PATH = `${import.meta.dir}/../../..`;
const NOW = "2026-10-21T00:00:00.000Z";
const SHA = "abc123";
const run = (conclusion: string | null, status = "completed", htmlUrl = "https://gh/run"): ActionsRun => ({
  name: "CI",
  status,
  conclusion,
  headSha: SHA,
  htmlUrl,
});

describe("merge watch", () => {
  const calls: string[] = [];
  let buildkiteBuilds: Array<Record<string, unknown>> = [];
  let runs: ActionsRun[] = [];
  let labels: string[] = [];
  let releasePrs: ReleasePr[] = [];

  const stub: MergeGitHub = {
    async enableAutoMerge() {
      return "enabled";
    },
    async disableAutoMerge() {},
    async listPullFiles() {
      return [];
    },
    async latestBaseRuns() {
      return [];
    },
    async runsForSha(_o, _r, sha) {
      calls.push(`runs ${sha}`);
      return runs;
    },
    async prLabels(t) {
      calls.push(`labels #${t.number}`);
      return labels;
    },
    async openReleasePrs() {
      calls.push("release-prs");
      return releasePrs;
    },
    async approvePr(t) {
      calls.push(`approve #${t.number}`);
    },
  };

  beforeAll(() => {
    createTestTables(sqlite);
    process.env.CLAUDE_JOBS_DIR = `${import.meta.dir}/../../../.test-jobs-merge-watch`;
  });

  beforeEach(() => {
    calls.length = 0;
    buildkiteBuilds = [];
    runs = [];
    labels = [];
    releasePrs = [];
    for (const t of ["claude_sessions", "tasks", "worktrees", "repositories", "settings"]) sqlite.exec(`DELETE FROM ${t}`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'Hivebrite', 'alumni_connect', 1), (2, 'Hivebrite', 'front-monorepo', 1)`);
    sqlite.exec(`INSERT INTO worktrees (id, repository_id, path, created_at, updated_at) VALUES (1, 1, '${MAIN_PATH}', 'x', 'x'), (2, 2, '${MAIN_PATH}', 'x', 'x')`);
    process.env.BUILDKITE_API_TOKEN = "bk";
    setBuildkiteFetch(async (input) => {
      calls.push(`buildkite ${new URL(String(input)).searchParams.get("commit")}`);
      return new Response(JSON.stringify(buildkiteBuilds));
    });
    setMergeGitHub(stub);
    setCapacityCheck(async () => "ok");
    setCommandRunner(async (cmd, args) => {
      calls.push([cmd, ...args.slice(0, 1)].join(" "));
      if (cmd === "claude" && args[0] === "--bg") return ok("backgrounded · abcd1234");
      return ok("[]");
    });
  });

  afterEach(() => {
    resetCommandRunner();
    resetMergeGitHub();
    resetBuildkiteFetch();
    delete process.env.BUILDKITE_API_TOKEN;
  });

  async function insertMerged(over: Partial<typeof tasks.$inferInsert> = {}): Promise<number> {
    const [row] = await db
      .insert(tasks)
      .values({
        title: "t",
        status: "Ready to Merge",
        createdAt: NOW,
        updatedAt: NOW,
        jiraKey: `EV-${Math.floor(Math.random() * 1e6)}`,
        repositoryId: 1,
        prNumber: 10,
        prState: "merged",
        mergeCommitSha: SHA,
        prSyncedAt: new Date().toISOString(),
        ...over,
      })
      .returning({ id: tasks.id });
    return row.id;
  }

  const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];
  const sessionsFor = (taskId: number) => db.select().from(claudeSessions).where(eq(claudeSessions.taskId, taskId));
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("marks a passed Buildkite build verified with its url", async () => {
    buildkiteBuilds = [{ number: 5, state: "passed", commit: SHA, web_url: "https://bk/5", finished_at: NOW }];
    const id = await insertMerged();

    await runMergeWatch();

    const row = await load(id);
    expect(calls).toEqual([`buildkite ${SHA}`]);
    expect(row.baseBuildState).toBe("passed");
    expect(row.baseBuildUrl).toBe("https://bk/5");
    expect(row.mergeVerifiedAt).not.toBeNull();

    calls.length = 0;
    await runMergeWatch();
    expect(calls).toEqual([]); // verified tasks leave the watch
  });

  it("records a pending build without verifying and skips the write when nothing changed", async () => {
    buildkiteBuilds = [{ number: 5, state: "running", commit: SHA, web_url: "https://bk/5", finished_at: null }];
    const id = await insertMerged();

    await runMergeWatch();
    const first = await load(id);
    expect(first.baseBuildState).toBe("pending");
    expect(first.mergeVerifiedAt).toBeNull();

    await runMergeWatch();
    expect((await load(id)).updatedAt).toBe(first.updatedAt);
  });

  it("gives up on a build that never appears after the timeout", async () => {
    const fresh = await insertMerged();
    const stale = await insertMerged({ prSyncedAt: "2026-10-01T00:00:00.000Z" });

    await runMergeWatch();

    expect((await load(fresh)).mergeVerifiedAt).toBeNull();
    expect((await load(fresh)).baseBuildState).toBe("missing");
    const gone = await load(stale);
    expect(gone.baseBuildState).toBe("missing");
    expect(gone.mergeVerifiedAt).not.toBeNull();
  });

  it("starts one auto sprint-red session on a red build and never a second", async () => {
    buildkiteBuilds = [{ number: 5, state: "failed", commit: SHA, web_url: "https://bk/5", finished_at: NOW }];
    const id = await insertMerged();

    await runMergeWatch();
    await settle();

    const row = await load(id);
    expect(row.baseBuildState).toBe("failed");
    expect(row.baseBuildUrl).toBe("https://bk/5");
    expect(row.mergeVerifiedAt).not.toBeNull();
    const sessions = await sessionsFor(id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].choreKey).toBe("sprint-red");
    expect(sessions[0].trigger).toBe("auto");
    expect(sessions[0].prompt).toBe(`/chore-sprint-red ${id}`);
    expect(sessions[0].cwd).toBe(MAIN_PATH);

    // Even if the task came back into the watch, the existing session blocks a duplicate.
    await db.update(tasks).set({ mergeVerifiedAt: null }).where(eq(tasks.id, id));
    await runMergeWatch();
    await settle();
    expect(await sessionsFor(id)).toHaveLength(1);
  });

  it("uses the configured sprint-red model and effort", async () => {
    sqlite.exec(`INSERT INTO settings (key, value) VALUES ('chore_models', '{"sprint-red":{"model":"opus","effort":"max"}}')`);
    buildkiteBuilds = [{ number: 5, state: "failed", commit: SHA, web_url: "w", finished_at: NOW }];
    const id = await insertMerged();

    await runMergeWatch();
    await settle();

    const [session] = await sessionsFor(id);
    expect(session.model).toBe("opus");
    expect(session.effort).toBe("max");
  });

  it("still verifies a red build when another session already holds the task", async () => {
    buildkiteBuilds = [{ number: 5, state: "failed", commit: SHA, web_url: "w", finished_at: NOW }];
    const id = await insertMerged();
    sqlite.exec(`INSERT INTO claude_sessions (task_id, repository_id, chore_key, chore_name, prompt, cwd, name, state, created_at, updated_at)
      VALUES (${id}, 1, 'ai-qa', 'AI QA', 'p', '/x', 'n', 'working', '${NOW}', '${NOW}')`);

    await runMergeWatch();

    expect((await load(id)).mergeVerifiedAt).not.toBeNull();
    expect((await sessionsFor(id)).map((s) => s.choreKey)).toEqual(["ai-qa"]);
  });

  it("reads Actions runs for repos off Buildkite and links the failed run", async () => {
    runs = [run("success"), run("failure", "completed", "https://gh/failed")];
    const id = await insertMerged({ repositoryId: 2, prNumber: 20 });

    await runMergeWatch();
    await settle();

    const row = await load(id);
    expect(calls[0]).toBe(`runs ${SHA}`);
    expect(row.baseBuildState).toBe("failed");
    expect(row.baseBuildUrl).toBe("https://gh/failed");
    expect(await sessionsFor(id)).toHaveLength(1);
  });

  it("approves only the unapproved release PRs of the merged PR's publish labels", async () => {
    runs = [run("success")];
    labels = ["publish-design-system-minor", "publish-icons-patch", "release-notes"];
    releasePrs = [
      { number: 900, title: "chore: publish design-system-3.1.0 [publish-design-system-minor]", approvedByMe: false },
      { number: 901, title: "chore: publish icons-1.0.1 [publish-icons-patch]", approvedByMe: true },
      { number: 902, title: "chore: publish utils-2.0.0 [publish-utils-major]", approvedByMe: false },
    ];
    const id = await insertMerged({ repositoryId: 2, prNumber: 20 });

    await runMergeWatch();

    expect(calls).toEqual([`runs ${SHA}`, "labels #20", "release-prs", "approve #900"]);
    expect((await load(id)).mergeVerifiedAt).not.toBeNull();
  });

  it("does not look for release PRs without publish labels, nor outside front-monorepo", async () => {
    runs = [run("success")];
    labels = ["bug"];
    await insertMerged({ repositoryId: 2, prNumber: 20 });
    buildkiteBuilds = [{ number: 5, state: "passed", commit: SHA, web_url: "w", finished_at: NOW }];
    await insertMerged({ repositoryId: 1, prNumber: 10 });

    await runMergeWatch();

    expect(calls).not.toContain("release-prs");
    expect(calls.filter((c) => c.startsWith("labels"))).toEqual(["labels #20"]);
  });

  it("keeps going when one task's build lookup fails", async () => {
    setMergeGitHub({ ...stub, runsForSha: async () => { throw new Error("boom"); } });
    buildkiteBuilds = [{ number: 5, state: "passed", commit: SHA, web_url: "w", finished_at: NOW }];
    const broken = await insertMerged({ repositoryId: 2, prNumber: 20 });
    const fine = await insertMerged();

    await runMergeWatch();

    expect((await load(broken)).mergeVerifiedAt).toBeNull();
    expect((await load(fine)).mergeVerifiedAt).not.toBeNull();
  });
});

describe("merge watch helpers", () => {
  it("collapses Actions runs of a commit", () => {
    expect(actionsBuildState([])).toBe("missing");
    expect(actionsBuildState([run("success"), run(null, "in_progress")])).toBe("pending");
    expect(actionsBuildState([run("success"), run("timed_out")])).toBe("failed");
    expect(actionsBuildState([run("success"), run("skipped")])).toBe("passed");
  });

  it("extracts the project from a publish label", () => {
    expect(publishProject("publish-design-system-minor")).toBe("design-system");
    expect(publishProject("publish-x-major")).toBe("x");
    expect(publishProject("release")).toBeNull();
    expect(publishProject("publish-x-rc")).toBeNull();
  });

  it("approves a release PR once even when two labels match it", async () => {
    const approved: number[] = [];
    const gh = {
      prLabels: async () => ["publish-ui-minor", "publish-ui-patch"],
      openReleasePrs: async () => [{ number: 1, title: "chore: publish ui-1.1.0 [publish-ui-minor]", approvedByMe: false }],
      approvePr: async (t: { number: number }) => {
        approved.push(t.number);
      },
    } as unknown as MergeGitHub;

    expect(await approveReleasePrs(gh, { owner: "o", repo: "r", number: 1 })).toEqual([1]);
    expect(approved).toEqual([1]);
  });
});
