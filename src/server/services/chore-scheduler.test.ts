import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { rmSync } from "fs";
import { db, sqlite } from "../../db";
import { claudeSessionTasks, claudeSessions, repositories, statusCategories, taskWorktrees, tasks, worktrees } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import { setSetting } from "../lib/settings";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { CHORE_MODELS_KEY } from "@/shared/chore-models";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import { setCapacityCheck, startChoreSession } from "./claude-sessions";
import {
  MAX_AUTO_ACTIVE,
  MAX_AUTO_RUNS_PER_DAY,
  runChoreScheduler,
} from "./chore-scheduler";

const ok = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
const JOBS_DIR = `${import.meta.dir}/../../../.test-scheduler-jobs`;
const MAIN_PATH = `${import.meta.dir}/../../..`; // any existing directory works as the checkout
const TS = "2026-01-01T00:00:00.000Z";
const NOON = new Date(2026, 9, 21, 12, 0, 0);

/** Let the background session start (worktree lookup + fake spawn) finish. */
const settle = () => new Promise((r) => setTimeout(r, 50));

type TaskOverrides = Partial<typeof tasks.$inferInsert>;

/** An In Progress PR with failing checks: fix-pr-checks (5) then continue-work (6) match it. */
async function seedTask(id: number, overrides: TaskOverrides = {}) {
  await db.insert(tasks).values({
    id,
    title: `Task ${id}`,
    status: "In Progress",
    createdAt: TS,
    updatedAt: TS,
    jiraKey: `EV-${id}`,
    repositoryId: 1,
    prNumber: 100 + id,
    headBranch: `fix/EV-${id}`,
    prState: "open",
    isDraft: 0,
    checksStatus: "failing",
    headSha: "aaa",
    unresolvedCommentCount: 0,
    hasConflicts: 0,
    ...overrides,
  });
  await db.insert(taskWorktrees).values({
    taskId: id,
    repositoryId: overrides.repositoryId ?? 1,
    path: MAIN_PATH,
    branch: `fix/EV-${id}`,
    state: "ready",
    createdAt: TS,
    updatedAt: TS,
  });
}

async function seedSession(taskId: number, overrides: Partial<typeof claudeSessions.$inferInsert> = {}) {
  await db.insert(claudeSessions).values({
    taskId,
    repositoryId: 1,
    choreKey: "fix-pr-checks",
    choreName: "Fix PR checks",
    prompt: `/chore-fix-pr-checks ${taskId}`,
    cwd: MAIN_PATH,
    name: `EV-${taskId} · Fix PR checks`,
    state: "done",
    trigger: "auto",
    triggerFingerprint: JSON.stringify(["aaa", null]),
    createdAt: new Date(NOON.getTime() - 60 * 60 * 1000).toISOString(),
    updatedAt: TS,
    ...overrides,
  });
}

const sessions = () => db.select().from(claudeSessions).orderBy(claudeSessions.id);
const setState = (state: string) => sqlite.exec(`UPDATE claude_sessions SET state = '${state}'`);

describe("runChoreScheduler", () => {
  beforeAll(() => {
    createTestTables(sqlite);
    process.env.CLAUDE_JOBS_DIR = JOBS_DIR;
  });

  beforeEach(async () => {
    for (const t of ["claude_session_tasks", "claude_sessions", "task_worktrees", "tasks", "worktrees", "repositories", "settings", "status_categories"]) {
      sqlite.exec(`DELETE FROM ${t}`);
    }
    invalidateStatusConfigCache();
    await db.insert(statusCategories).values([
      { name: "Done", color: "green", done: 1, displayOrder: 0, jiraMappings: "[]" },
      { name: "Code Review", color: "purple", done: 0, displayOrder: 1, jiraMappings: "[]" },
      { name: "In Progress", color: "blue", done: 0, displayOrder: 2, jiraMappings: "[]" },
      { name: "Backlog", color: "gray", done: 0, displayOrder: 3, jiraMappings: "[]" },
    ]);
    await db.insert(repositories).values([
      { id: 1, owner: "hb", repo: "alumni_connect", enabled: 1, deploymentBranches: JSON.stringify(["staging", "qa"]) },
      { id: 2, owner: "hb", repo: "front-monorepo", enabled: 1, deploymentBranches: JSON.stringify(["qa"]) },
    ]);
    await db.insert(worktrees).values([
      { id: 1, repositoryId: 1, path: MAIN_PATH, createdAt: TS, updatedAt: TS },
      { id: 2, repositoryId: 2, path: MAIN_PATH, createdAt: TS, updatedAt: TS },
    ]);
    setCapacityCheck(async () => "ok");
    let spawns = 0; // shortId is unique per session
    setCommandRunner(async (cmd, args) => {
      if (cmd === "claude" && args[0] === "--bg") return ok(`backgrounded · ${String(++spawns).padStart(8, "0")}`);
      if (cmd === "claude" && args[0] === "agents") return ok("[]");
      return ok();
    });
  });

  afterEach(async () => {
    await settle();
    resetCommandRunner();
    rmSync(JOBS_DIR, { recursive: true, force: true });
  });

  it("starts one auto chore per task with trigger, fingerprint and the chore's model settings", async () => {
    await seedTask(1);
    await setSetting(CHORE_MODELS_KEY, JSON.stringify({ "fix-pr-checks": { model: "opus", effort: "low" } }));

    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: 1,
      choreKey: "fix-pr-checks",
      prompt: "/chore-fix-pr-checks 1",
      trigger: "auto",
      triggerFingerprint: JSON.stringify(["aaa", null]),
      model: "opus",
      effort: "low",
      state: "working",
    });
  });

  it("never restarts a chore on the same task state, whatever became of the last run", async () => {
    await seedTask(1);
    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();

    for (const state of ["done", "failed", "stopped"]) {
      setState(state);
      expect(await runChoreScheduler({ now: NOON })).toBe(0);
    }
    // continue-work also matches the task, yet the tick stops at its first chore
    expect(await sessions()).toHaveLength(1);
  });

  it("treats a manual run on the same state as done", async () => {
    await seedTask(1);
    await startChoreSession(1, "fix-pr-checks");
    await settle();
    setState("done");

    expect(await runChoreScheduler({ now: NOON })).toBe(0);
    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger).toBe("manual");
  });

  it("restarts once the task state changes", async () => {
    await seedTask(1);
    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();
    setState("done");
    sqlite.exec("UPDATE tasks SET head_sha = 'bbb' WHERE id = 1");

    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();

    const rows = await sessions();
    expect(rows).toHaveLength(2);
    expect(rows[1].triggerFingerprint).toBe(JSON.stringify(["bbb", null]));
  });

  it("restarts fix-pr-checks when CI fails again on the same commit", async () => {
    const failedAt = (completedAt: string) =>
      JSON.stringify([{ name: "buildkite", status: "completed", conclusion: "failure", url: null, isRequired: true, completedAt }]);
    await seedTask(1, { checksDetails: failedAt("2026-10-21T11:00:00Z") });
    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();
    setState("done");
    expect(await runChoreScheduler({ now: NOON })).toBe(0);

    sqlite.exec(`UPDATE tasks SET checks_details = '${failedAt("2026-10-21T11:40:00Z")}' WHERE id = 1`);
    expect(await runChoreScheduler({ now: NOON })).toBe(1);
  });

  it("caps auto runs of one chore on one task per day", async () => {
    await seedTask(1);
    for (let i = 0; i < MAX_AUTO_RUNS_PER_DAY; i++) {
      await seedSession(1, { triggerFingerprint: JSON.stringify([`old-${i}`]) });
    }
    expect(await runChoreScheduler({ now: NOON })).toBe(0);

    // the window is rolling: a day later the chore may run again
    const later = new Date(NOON.getTime() + 25 * 60 * 60 * 1000);
    expect(await runChoreScheduler({ now: later })).toBe(1);
  });

  it("runs at most MAX_AUTO_ACTIVE auto sessions at once", async () => {
    for (let id = 1; id <= MAX_AUTO_ACTIVE + 1; id++) await seedTask(id);

    expect(await runChoreScheduler({ now: NOON })).toBe(MAX_AUTO_ACTIVE);
    await settle();
    expect(await runChoreScheduler({ now: NOON })).toBe(0);
    expect((await sessions()).map((s) => s.taskId)).toEqual([1, 2, 3, 4, 5]);
  });

  it("starts nothing while a session waits for a Docker slot", async () => {
    await seedTask(1);
    await seedTask(2);
    await seedSession(2, { state: "queued", trigger: "manual", choreKey: "ai-qa", choreName: "AI QA" });

    expect(await runChoreScheduler({ now: NOON })).toBe(0);
  });

  it("skips a task that already has a session running", async () => {
    await seedTask(1);
    await seedSession(1, { state: "working", trigger: "manual", choreKey: "request-reviews", choreName: "Request Code Reviews", triggerFingerprint: null });

    expect(await runChoreScheduler({ now: NOON })).toBe(0);
    expect(await sessions()).toHaveLength(1);
  });

  it("stays quiet when disabled and on opted-out tasks", async () => {
    await seedTask(1);
    await setSetting(AUTO_CHORES_SETTING, "false");
    expect(await runChoreScheduler({ now: NOON })).toBe(0);
    await setSetting(AUTO_CHORES_SETTING, "true");

    sqlite.exec(`UPDATE tasks SET chore_skips = '{"auto":true}' WHERE id = 1`);
    expect(await runChoreScheduler({ now: NOON })).toBe(0);
    expect(await sessions()).toHaveLength(0);
  });

  it("auto-deploys to staging only when the repo has that branch", async () => {
    const deployable: TaskOverrides = { status: "Code Review", checksStatus: "passing" };
    await seedTask(1, deployable);
    await seedTask(2, { ...deployable, repositoryId: 2 });

    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: 1, choreKey: "deploy-test-env", prompt: "/chore-deploy-to-test-env 1 staging" });
  });

  it("never starts a task on its own", async () => {
    await seedTask(1, { status: "Backlog", prNumber: null, prState: null, checksStatus: null });

    expect(await runChoreScheduler({ now: NOON })).toBe(0);
  });

  it("batches a bulk chore: every task at that step of a repository in one session, the rest linked", async () => {
    const draft: TaskOverrides = { checksStatus: "passing", isDraft: 1 }; // AI QA
    await seedTask(1, draft);
    await seedTask(2, draft);
    await seedTask(3, { ...draft, repositoryId: 2 });

    expect(await runChoreScheduler({ now: NOON })).toBe(2);
    await settle();
    const rows = await sessions();
    expect(rows.map((r) => [r.taskId, r.choreKey, r.prompt, r.name])).toEqual([
      [1, "ai-qa", "/chore-ai-qa 1 2", "EV-1 +1 · AI QA"],
      [3, "ai-qa", "/chore-ai-qa 3", "EV-3 · AI QA"],
    ]);
    expect(await db.select().from(claudeSessionTasks)).toMatchObject([
      { sessionId: rows[0].id, taskId: 2, triggerFingerprint: JSON.stringify(["In Progress", "aaa"]) },
    ]);

    // a linked task is busy while the batch runs, then done on that state
    sqlite.exec(`UPDATE tasks SET head_sha = 'bbb' WHERE id = 2`);
    expect(await runChoreScheduler({ now: NOON })).toBe(0);
    setState("done");
    sqlite.exec(`UPDATE tasks SET head_sha = 'aaa' WHERE id = 2`);
    expect(await runChoreScheduler({ now: NOON })).toBe(0);

    // a new state waits for the periodic sync, not a post-session run
    sqlite.exec(`UPDATE tasks SET head_sha = 'bbb' WHERE id = 2`);
    expect(await runChoreScheduler({ taskId: 2, now: NOON })).toBe(0);
    expect(await runChoreScheduler({ now: NOON })).toBe(1);
    await settle();
    expect((await sessions()).at(-1)).toMatchObject({ taskId: 2, prompt: "/chore-ai-qa 2" });
  });

  it("limits a post-session run to that task", async () => {
    await seedTask(1);
    await seedTask(2);

    expect(await runChoreScheduler({ taskId: 2, now: NOON })).toBe(1);
    await settle();
    expect((await sessions()).map((s) => s.taskId)).toEqual([2]);
  });
});
