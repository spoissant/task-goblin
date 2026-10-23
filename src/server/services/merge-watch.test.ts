import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { actionsBuildState, approveReleasePrs, publishProject, runMergeWatch } from "./merge-watch";
import { resetMergeGitHub, setMergeGitHub, type ActionsRun, type MergeGitHub, type ReleasePr } from "./merge-github";

const NOW = "2026-10-21T00:00:00.000Z";
const SHA = "abc123";
const run = (conclusion: string | null, status = "completed"): ActionsRun => ({ status, conclusion });

describe("merge watch", () => {
  const calls: string[] = [];
  let runs: ActionsRun[] = [];
  let labels: string[] = [];
  let releasePrs: ReleasePr[] = [];

  const stub: MergeGitHub = {
    async mergePr() {
      return { sha: "m" };
    },
    async listPullFiles() {
      return [];
    },
    async runsForSha(_o, repo, sha) {
      calls.push(`runs ${repo} ${sha}`);
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
  });

  beforeEach(() => {
    calls.length = 0;
    runs = [];
    labels = [];
    releasePrs = [];
    for (const t of ["tasks", "repositories"]) sqlite.run(`DELETE FROM ${t}`);
    sqlite.run(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'Hivebrite', 'alumni_connect', 1), (2, 'Hivebrite', 'front-monorepo', 1)`);
    setMergeGitHub(stub);
  });

  afterEach(() => {
    resetMergeGitHub();
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
        repositoryId: 2,
        prNumber: 20,
        prState: "merged",
        mergeCommitSha: SHA,
        prSyncedAt: new Date().toISOString(),
        ...over,
      })
      .returning({ id: tasks.id });
    return row.id;
  }

  const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

  it("approves only the unapproved release PRs of the merged PR's publish labels once its runs pass", async () => {
    runs = [run("success")];
    labels = ["publish-design-system-minor", "publish-icons-patch", "release-notes"];
    releasePrs = [
      { number: 900, title: "chore: publish design-system-3.1.0 [publish-design-system-minor]", approvedByMe: false },
      { number: 901, title: "chore: publish icons-1.0.1 [publish-icons-patch]", approvedByMe: true },
      { number: 902, title: "chore: publish utils-2.0.0 [publish-utils-major]", approvedByMe: false },
    ];
    const id = await insertMerged();

    await runMergeWatch();

    expect(calls).toEqual([`runs front-monorepo ${SHA}`, "labels #20", "release-prs", "approve #900"]);
    expect((await load(id)).mergeVerifiedAt).not.toBeNull();

    calls.length = 0;
    await runMergeWatch();
    expect(calls).toEqual([]); // verified tasks leave the watch
  });

  it("does not look for release PRs without publish labels", async () => {
    runs = [run("success")];
    labels = ["bug"];
    const id = await insertMerged();

    await runMergeWatch();

    expect(calls).toEqual([`runs front-monorepo ${SHA}`, "labels #20"]);
    expect((await load(id)).mergeVerifiedAt).not.toBeNull();
  });

  it("stops watching red runs without approving anything", async () => {
    runs = [run("success"), run("failure")];
    const id = await insertMerged();

    await runMergeWatch();

    expect(calls).toEqual([`runs front-monorepo ${SHA}`]);
    expect((await load(id)).mergeVerifiedAt).not.toBeNull();
  });

  it("writes nothing while the runs are pending or not there yet", async () => {
    runs = [run("success"), run(null, "in_progress")];
    const pending = await insertMerged();

    await runMergeWatch();
    runs = [];
    await runMergeWatch();

    const row = await load(pending);
    expect(row.mergeVerifiedAt).toBeNull();
    expect(row.updatedAt).toBe(NOW);
    expect(calls.filter((c) => c.startsWith("labels"))).toEqual([]);
  });

  it("gives up on runs that never finish after the timeout", async () => {
    runs = [run(null, "queued")];
    const fresh = await insertMerged();
    const stale = await insertMerged({ prSyncedAt: "2026-10-01T00:00:00.000Z" });

    await runMergeWatch();

    expect((await load(fresh)).mergeVerifiedAt).toBeNull();
    expect((await load(stale)).mergeVerifiedAt).not.toBeNull();
    expect(calls).not.toContain("release-prs");
  });

  it("watches only front-monorepo", async () => {
    runs = [run("success")];
    const other = await insertMerged({ repositoryId: 1, prNumber: 10 });

    await runMergeWatch();

    expect(calls).toEqual([]);
    expect((await load(other)).mergeVerifiedAt).toBeNull();
  });

  it("keeps going when one task's runs lookup fails", async () => {
    runs = [run("success")];
    setMergeGitHub({
      ...stub,
      async runsForSha(_o, _r, sha) {
        if (sha === "broken") throw new Error("boom");
        return runs;
      },
    });
    const broken = await insertMerged({ mergeCommitSha: "broken" });
    const fine = await insertMerged({ prNumber: 21 });

    await runMergeWatch();

    expect((await load(broken)).mergeVerifiedAt).toBeNull();
    expect((await load(fine)).mergeVerifiedAt).not.toBeNull();
  });
});

describe("merge watch helpers", () => {
  it("collapses Actions runs of a commit", () => {
    expect(actionsBuildState([])).toBe("pending");
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
