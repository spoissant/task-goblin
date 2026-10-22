/**
 * Background Claude Code sessions per task: one fresh session per chore run,
 * never resumed. Continuity lives in the worktree, Task Goblin and the PR.
 * PR reviews from the Reviews page are the exception: no task, keyed by PR URL.
 * This starts and stops them; session-poller.ts follows them while they run.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { findRepository, getTaskWithRepository } from "../lib/queries";
import { getSetting } from "../lib/settings";
import { loadOtherTasks } from "../lib/other-tasks";
import { parsePrUrl } from "../lib/validation";
import { CUSTOM_CHORE, REVIEW_CHORE, fingerprintFor, getChoreDefinition } from "../lib/chores";
import { CHORE_MODELS_KEY, parseChoreModelDefaults, resolveChoreModel } from "@/shared/chore-models";
import { resolvePrompt } from "@/shared/chores";
import { broadcast } from "../lib/sse";
import type { ClaudeSession, ClaudeSessionState } from "../../shared/types";
import {
  CHORE_SESSION_SETTINGS,
  TERMINAL_STATES,
  respawnSession as cliRespawn,
  sessionLink,
  spawnBackground,
  stopSession as cliStop,
} from "./claude-cli";
import { ensureTaskWorktree, reconcileWorktrees, resolveMainPath } from "./task-worktrees";
import { getDevStackStatus } from "./dev-stack";
import { ensureStackCapacity } from "./docker-stacks";
import { coversTasks, findActiveSession, isActive, linkSessionTasks, sessionLinks } from "./session-tasks";

export type SessionRow = typeof claudeSessions.$inferSelect;

/** API shape of each row, with the other tasks a bulk run covers. */
export async function toApiList<T extends SessionRow>(rows: T[]): Promise<(T & ClaudeSession)[]> {
  const links = await sessionLinks(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...row,
    state: row.state as ClaudeSessionState,
    link: sessionLink(row.bridgeSessionId),
    linkedTaskIds: (links.get(row.id) ?? []).map((l) => l.taskId),
  }));
}

export async function toApi(row: SessionRow): Promise<ClaudeSession> {
  return (await toApiList([row]))[0];
}

async function getRow(id: number): Promise<SessionRow | null> {
  const rows = await db.select().from(claudeSessions).where(eq(claudeSessions.id, id));
  return rows[0] ?? null;
}

/** Write a session row and tell the UI; a session that ended changes its task's row too. */
export async function updateSession(id: number, updates: Partial<SessionRow>): Promise<SessionRow> {
  const rows = await db
    .update(claudeSessions)
    .set({ ...updates, updatedAt: now() })
    .where(eq(claudeSessions.id, id))
    .returning();
  const row = rows[0];
  broadcast("session");
  if (TERMINAL_STATES.includes(row.state as ClaudeSessionState)) broadcast("task");
  return row;
}

async function getSession(id: number): Promise<SessionRow> {
  const row = await getRow(id);
  if (!row) throw new NotFoundError("Session", id);
  return row;
}

/** The task's sessions, bulk runs it is linked into included. */
export async function listTaskSessions(taskId: number): Promise<SessionRow[]> {
  return db.select().from(claudeSessions).where(coversTasks([taskId])).orderBy(desc(claudeSessions.id));
}

/** Newest session per task, linked tasks of bulk runs included, for the tasks table. */
export async function listLatestSessions(): Promise<SessionRow[]> {
  return db
    .select()
    .from(claudeSessions)
    .where(
      sql`${claudeSessions.id} IN (SELECT MAX(id) FROM (
        SELECT id, task_id FROM claude_sessions WHERE task_id IS NOT NULL
        UNION ALL SELECT session_id, task_id FROM claude_session_tasks
      ) GROUP BY task_id)`,
    )
    .orderBy(desc(claudeSessions.id));
}

/** Newest session per reviewed PR, for the Reviews page. */
export async function listLatestReviewSessions(): Promise<SessionRow[]> {
  return db
    .select()
    .from(claudeSessions)
    .where(
      sql`${claudeSessions.id} IN (SELECT MAX(id) FROM claude_sessions WHERE pr_url IS NOT NULL GROUP BY pr_url)`,
    )
    .orderBy(desc(claudeSessions.id));
}

/**
 * A page of sessions across all tasks and PR reviews, newest first, with the task title, for the sessions page.
 * `since` (ISO) keeps sessions Claude was active in from then on: last activity, or creation if it never ran.
 */
export async function listRecentSessions(
  limit: number,
  offset: number,
  since: string | null = null,
): Promise<{ rows: (SessionRow & { taskTitle: string | null })[]; total: number }> {
  const where = since ? sql`coalesce(${claudeSessions.claudeUpdatedAt}, ${claudeSessions.createdAt}) >= ${since}` : undefined;
  const rows = await db
    .select({ session: claudeSessions, taskTitle: tasks.title })
    .from(claudeSessions)
    .leftJoin(tasks, eq(tasks.id, claudeSessions.taskId))
    .where(where)
    .orderBy(desc(claudeSessions.id))
    .limit(limit)
    .offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(claudeSessions).where(where);
  return { rows: rows.map((r) => ({ ...r.session, taskTitle: r.taskTitle })), total: count };
}

/** Chores that QA on the repository's one dev stack: one task at a time per repository. */
const DEV_STACK_CHORES = ["ai-qa"];

/** Refuse a dev-stack chore while another task's run or stack holds the repository's stack. */
async function assertDevStackFree(taskIds: number[], repositoryId: number): Promise<void> {
  const [other] = await db
    .select({ taskId: claudeSessions.taskId })
    .from(claudeSessions)
    .where(and(eq(claudeSessions.repositoryId, repositoryId), inArray(claudeSessions.choreKey, DEV_STACK_CHORES), isActive()))
    .limit(1);
  if (other) throw new AppError(`AI QA is already running on task ${other.taskId}`, 409, "DEV_STACK_BUSY");
  const { stack } = await getDevStackStatus({ taskId: taskIds[0] });
  const owners = stack ? [stack.taskId, ...stack.mergedTaskIds] : [];
  if (stack && !taskIds.some((id) => owners.includes(id))) {
    throw new AppError(`Dev stack belongs to ${stack.branch}`, 409, "DEV_STACK_BUSY");
  }
}

/** The model and effort a session runs with: the caller's, else its chore's defaults from the Settings page. */
async function modelFor(choreKey: string, input: { model?: string | null; effort?: string | null }) {
  const defaults = resolveChoreModel(parseChoreModelDefaults(await getSetting(CHORE_MODELS_KEY)), choreKey);
  return { model: input.model ?? defaults.model, effort: input.effort ?? defaults.effort };
}

type SessionTrigger = "auto" | "manual";

interface ChoreSessionInput {
  /** Replaces the chore's own prompt, e.g. the command plus hand-typed context. */
  prompt?: string | null;
  /** Model and effort default to the chore's settings. */
  model?: string | null;
  effort?: string | null;
  /** Who started it: the chore scheduler or a person (default). */
  trigger?: SessionTrigger;
  /** The task state the chore was started on; the scheduler won't restart it on the same state. */
  triggerFingerprint?: string | null;
  /** The other tasks of a bulk chore run, linked to the session; checked by loadOtherTasks. */
  withTaskIds?: number[];
}

/**
 * Validate and record a session start, then continue in the background.
 * Returns the row in `preparing`.
 */
export async function startChoreSession(
  taskId: number,
  choreKey: string,
  input: ChoreSessionInput = {},
): Promise<SessionRow> {
  const chore = getChoreDefinition(choreKey);
  if (!chore) throw new AppError(`Unknown chore: ${choreKey}`, 400, "UNKNOWN_CHORE");
  const override = input.prompt?.trim();
  return createSession(taskId, {
    chore,
    withTaskIds: input.withTaskIds,
    prompt: (task, taskIds) => override || resolvePrompt(chore.prompt, task, taskIds),
    model: input.model,
    effort: input.effort,
    trigger: input.trigger ?? "manual",
    triggerFingerprint: input.triggerFingerprint ?? null,
  });
}

interface CustomSessionInput {
  prompt: string;
  model?: string | null;
  effort?: string | null;
}

/** Start a session from a prompt typed by hand, in the task's worktree. */
export async function startCustomSession(taskId: number, input: CustomSessionInput): Promise<SessionRow> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new AppError("prompt is required", 400, "VALIDATION_ERROR");
  return createSession(taskId, { chore: CUSTOM_CHORE, prompt: () => prompt, model: input.model, effort: input.effort });
}

/**
 * Review a colleague's PR in its repo's main checkout, with no task. Any
 * number can run at once; only one per PR.
 */
export async function startReviewSession(
  prUrl: string,
  opts: { model?: string | null; effort?: string | null } = {},
): Promise<SessionRow> {
  const { url, owner, repo, number } = parsePrUrl(prUrl);

  const repository = await findRepository(owner, repo);
  if (!repository) throw new AppError(`Repository ${owner}/${repo} is not configured`, 400, "NO_REPOSITORY");
  const cwd = resolveMainPath(repository);

  const active = await db
    .select()
    .from(claudeSessions)
    .where(and(eq(claudeSessions.prUrl, url), isActive()))
    .limit(1);
  if (active[0]) {
    throw new AppError(`Session ${active[0].id} is already ${active[0].state} on this PR`, 409, "SESSION_ACTIVE");
  }

  const timestamp = now();
  const rows = await db
    .insert(claudeSessions)
    .values({
      taskId: null,
      prUrl: url,
      repositoryId: repository.id,
      choreKey: REVIEW_CHORE.key,
      choreName: REVIEW_CHORE.name,
      prompt: `${REVIEW_CHORE.prompt} ${url}`,
      cwd,
      name: `${repository.alias ?? repository.repo}#${number} · ${REVIEW_CHORE.name}`,
      ...(await modelFor(REVIEW_CHORE.key, opts)),
      state: "preparing",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  const row = rows[0];
  broadcast("session");
  void runStart(row.id);
  return row;
}

type ChoreLike = { key: string; name: string; cwd: "task" | "main"; supportsBulk?: boolean; requiresSameRepo?: boolean };
type TaskForPrompt = { id: number; jiraKey: string | null };

async function createSession(
  taskId: number,
  opts: {
    chore: ChoreLike;
    /** `taskIds`: the task, then the other tasks of a bulk run. */
    prompt: (task: TaskForPrompt, taskIds: number[]) => string;
    model?: string | null;
    effort?: string | null;
    trigger?: SessionTrigger;
    triggerFingerprint?: string | null;
    withTaskIds?: number[];
  },
): Promise<SessionRow> {
  const result = await getTaskWithRepository(taskId);
  if (!result) throw new NotFoundError("Task", taskId);
  const { repository, ...task } = result;

  const { chore } = opts;
  if (!repository) throw new AppError("Task has no associated repository", 400, "NO_REPOSITORY");
  // A task chore's worktree is set up, and its path known, once runStart has run.
  const mainPath = resolveMainPath(repository);

  const others = await checkLinkedTasks(taskId, chore, repository.id, opts.withTaskIds);
  const taskIds = [taskId, ...others.map((other) => other.id)];
  if (DEV_STACK_CHORES.includes(chore.key)) await assertDevStackFree(taskIds, repository.id);

  const timestamp = now();
  const rows = await db
    .insert(claudeSessions)
    .values({
      taskId,
      repositoryId: repository.id,
      choreKey: chore.key,
      choreName: chore.name,
      prompt: opts.prompt(task, taskIds),
      cwd: mainPath,
      name: `${task.jiraKey ?? `#${task.id}`}${others.length > 0 ? ` +${others.length}` : ""} · ${chore.name}`,
      ...(await modelFor(chore.key, opts)),
      trigger: opts.trigger ?? "manual",
      // A manual run records the state too, so the scheduler won't redo it.
      triggerFingerprint: opts.triggerFingerprint ?? fingerprintFor(chore.key, task),
      state: "preparing",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  const row = rows[0];
  await linkSessionTasks(row.id, others.map((other) => ({ taskId: other.id, triggerFingerprint: fingerprintFor(chore.key, other) })));
  broadcast("session");
  void runStart(row.id);
  return row;
}

/**
 * The other tasks of a bulk run (in the repository when the chore needs it),
 * refused for a chore that runs on one task at a time. The task and each of
 * them must be idle.
 */
async function checkLinkedTasks(taskId: number, chore: ChoreLike, repositoryId: number, withTaskIds?: number[]) {
  const active = await findActiveSession(taskId);
  if (active) {
    throw new AppError(`Session ${active.id} is already ${active.state} on this task`, 409, "SESSION_ACTIVE");
  }
  const others = await loadOtherTasks(withTaskIds, taskId, chore.requiresSameRepo ? repositoryId : undefined);
  if (others.length > 0 && !chore.supportsBulk) {
    throw new AppError(`${chore.name} runs on one task at a time`, 400, "VALIDATION_ERROR");
  }
  for (const other of others) {
    const busy = await findActiveSession(other.id);
    if (busy) throw new AppError(`Session ${busy.id} is already ${busy.state} on task ${other.id}`, 409, "SESSION_ACTIVE");
  }
  return others;
}

// Capacity check + spawn are serialized so two starts cannot both pass the cap.
let spawnChain: Promise<void> = Promise.resolve();

async function runStart(sessionId: number): Promise<void> {
  try {
    const row = await getRow(sessionId);
    if (!row || (row.state !== "preparing" && row.state !== "queued")) return;

    const chore = getChoreDefinition(row.choreKey) ?? [CUSTOM_CHORE, REVIEW_CHORE].find((c) => c.key === row.choreKey);
    if (!chore) {
      await updateSession(sessionId, { state: "failed", error: `Unknown chore: ${row.choreKey}` });
      return;
    }

    let cwd = row.cwd;
    if (chore.cwd === "task") {
      if (row.taskId === null) {
        await updateSession(sessionId, { state: "failed", error: `${chore.name} needs a task` });
        return;
      }
      const worktree = await ensureTaskWorktree(row.taskId);
      if (worktree.state !== "ready") {
        await updateSession(sessionId, {
          state: "failed",
          error: `Worktree ${worktree.state}${worktree.error ? `: ${worktree.error}` : ""}`,
        });
        return;
      }
      cwd = worktree.path;
    }

    const task = spawnChain.then(() => spawnGated(sessionId, cwd));
    spawnChain = task.catch(() => undefined);
    await task;
  } catch (err) {
    await updateSession(sessionId, { state: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

async function spawnGated(sessionId: number, cwd: string): Promise<void> {
  const row = await getRow(sessionId);
  if (!row || (row.state !== "preparing" && row.state !== "queued")) return; // stopped meanwhile

  // The cap guards task Docker stacks; a task-less PR review never boots one.
  if (row.taskId !== null && (await ensureStackCapacity(cwd)) === "queued") {
    if (row.state !== "queued") await updateSession(sessionId, { state: "queued", cwd });
    return;
  }

  const spawned = await spawnBackground({
    cwd,
    name: row.name,
    prompt: row.prompt,
    model: row.model,
    effort: row.effort,
    settings: row.choreKey === CUSTOM_CHORE.key ? undefined : CHORE_SESSION_SETTINGS,
  });
  if ("error" in spawned) {
    await updateSession(sessionId, { state: "failed", cwd, error: spawned.error });
    return;
  }
  await updateSession(sessionId, { state: "working", cwd, shortId: spawned.shortId, error: null });
}

export async function stopSession(id: number): Promise<SessionRow> {
  const row = await getSession(id);
  if (TERMINAL_STATES.includes(row.state as ClaudeSessionState)) return row;
  if (row.shortId) await cliStop(row.shortId);
  return updateSession(id, {
    state: "stopped",
    processStoppedAt: row.shortId ? now() : null,
  });
}

/** Restart a session whose process was stopped or died, e.g. by the idle reaper. */
export async function respawnSession(id: number): Promise<SessionRow> {
  const row = await getSession(id);
  if (!row.shortId) throw new AppError("Session never started a process", 400, "NO_PROCESS");
  const result = await cliRespawn(row.shortId);
  if (result.exitCode !== 0) {
    const output = (result.stderr || result.stdout).trim();
    throw new AppError(`claude respawn failed${output ? `: ${output}` : ""}`, 502, "RESPAWN_FAILED");
  }
  return updateSession(id, { processStoppedAt: null });
}

/** Start queued sessions in order while capacity allows. */
export async function startQueued(): Promise<void> {
  const rows = await db
    .select()
    .from(claudeSessions)
    .where(eq(claudeSessions.state, "queued"))
    .orderBy(claudeSessions.id);
  for (const row of rows) {
    await runStart(row.id);
    const after = await getRow(row.id);
    if (after?.state === "queued") break; // still no capacity
  }
}

/** Resume work interrupted by a server restart. */
export async function reconcileOnStartup(): Promise<void> {
  await reconcileWorktrees();
  const rows = await db.select().from(claudeSessions).where(eq(claudeSessions.state, "preparing"));
  for (const row of rows) void runStart(row.id);
}
