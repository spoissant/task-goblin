/**
 * The Inbox: what waits on the user, read from the DB only (no GitHub calls).
 * Pending review drafts are not here: the client reads them from
 * /github/review-requests?scope=others, which already fans out to GitHub.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, repositories, tasks } from "../../db/schema";
import { buildRepoMap } from "../lib/queries";
import { getStatusCategories, type StatusCategory } from "../lib/task-status";
import { ACTIONABLE_HOLDS, parseMergeHold } from "../../shared/merge";
import type { InboxItem, InboxSession, InboxTask } from "../../shared/inbox";
import { sessionLink } from "./claude-cli";
import { ACTIVE_STATES } from "./claude-sessions";

type TaskRow = typeof tasks.$inferSelect;
type SessionRow = typeof claudeSessions.$inferSelect;
type RepoMap = Map<number, typeof repositories.$inferSelect>;

const FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SPRINT_RED_RESOLVED_MS = 24 * 60 * 60 * 1000;

export async function listInbox(): Promise<InboxItem[]> {
  const categories = await getStatusCategories();
  const items: InboxItem[] = [
    ...(await blockedSessions()),
    ...(await failedSessions()),
    ...(await mergeHolds(categories)),
    ...(await sprintRedTasks()),
    ...(await readyToStart(categories)),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

function toInboxSession(row: SessionRow): InboxSession {
  return {
    id: row.id,
    choreKey: row.choreKey,
    choreName: row.choreName,
    name: row.name,
    state: row.state,
    needs: row.needs,
    detail: row.detail,
    error: row.error,
    link: sessionLink(row.bridgeSessionId),
    shortId: row.shortId,
    prUrl: row.prUrl,
  };
}

function toInboxTask(row: TaskRow, repos: RepoMap): InboxTask {
  const repo = row.repositoryId !== null ? repos.get(row.repositoryId) : undefined;
  return {
    id: row.id,
    title: row.title,
    jiraKey: row.jiraKey,
    status: row.status,
    prNumber: row.prNumber,
    repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
  };
}

/** `LOWER(tasks.status)` in the category's own name and Jira mappings; never matches when the category is missing. */
function statusIn(categories: StatusCategory[], categoryName: string) {
  const category = categories.find((c) => c.name === categoryName);
  if (!category) return sql`1 = 0`;
  const statuses = [category.name, ...category.jiraMappings].map((s) => s.toLowerCase().replace(/_/g, " "));
  return sql`REPLACE(LOWER(${tasks.status}), '_', ' ') IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`;
}

/** Sessions joined to their task, newest first. */
async function sessionsWithTask(where: ReturnType<typeof and>) {
  const rows = await db
    .select({ session: claudeSessions, task: tasks })
    .from(claudeSessions)
    .leftJoin(tasks, eq(tasks.id, claudeSessions.taskId))
    .where(where)
    .orderBy(desc(claudeSessions.id));
  const repos = await buildRepoMap(rows.map((r) => r.task).filter((t): t is TaskRow => t !== null));
  return rows.map((r) => ({ session: r.session, task: r.task ? toInboxTask(r.task, repos) : null }));
}

async function blockedSessions(): Promise<InboxItem[]> {
  const rows = await sessionsWithTask(eq(claudeSessions.state, "blocked"));
  return rows.map(({ session, task }) => ({ kind: "blocked", at: session.updatedAt, session: toInboxSession(session), task }));
}

/**
 * Failed sessions of the last 7 days, when nothing newer ran for the same
 * task (or reviewed PR) and chore: a later retry, done or not, replaces them.
 */
async function failedSessions(): Promise<InboxItem[]> {
  const cutoff = new Date(Date.now() - FAILED_WINDOW_MS).toISOString();
  const rows = await sessionsWithTask(gte(claudeSessions.createdAt, cutoff));
  const seen = new Set<string>();
  const items: InboxItem[] = [];
  for (const { session, task } of rows) {
    const key = `${session.taskId ?? session.prUrl}|${session.choreKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (session.state !== "failed") continue;
    items.push({ kind: "failed", at: session.updatedAt, session: toInboxSession(session), task });
  }
  return items;
}

/** Open PRs the merge gate holds for a reason the user has to act on. */
async function mergeHolds(categories: StatusCategory[]): Promise<InboxItem[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(isNotNull(tasks.mergeHold), eq(tasks.prState, "open"), isNotNull(tasks.prNumber), statusIn(categories, "Ready to Merge")));
  const repos = await buildRepoMap(rows);
  const items: InboxItem[] = [];
  for (const row of rows) {
    const hold = parseMergeHold(row.mergeHold);
    const reasons = hold?.reasons.filter((r) => ACTIONABLE_HOLDS.has(r)) ?? [];
    const task = toInboxTask(row, repos);
    if (!hold || reasons.length === 0 || !task.repository) continue;
    const prUrl = `https://github.com/${task.repository.owner}/${task.repository.repo}/pull/${row.prNumber}`;
    items.push({ kind: "merge-hold", at: hold.at, task, reasons, prUrl });
  }
  return items;
}

/** Merged PRs whose base-branch build failed, until the sprint-red session has been done for a day. */
async function sprintRedTasks(): Promise<InboxItem[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.baseBuildState, "failed"));
  if (rows.length === 0) return [];
  const repos = await buildRepoMap(rows);
  const sessions = await db
    .select()
    .from(claudeSessions)
    .where(and(eq(claudeSessions.choreKey, "sprint-red"), inArray(claudeSessions.taskId, rows.map((r) => r.id))))
    .orderBy(desc(claudeSessions.id));
  const latest = new Map<number, SessionRow>();
  for (const s of sessions) if (s.taskId !== null && !latest.has(s.taskId)) latest.set(s.taskId, s);

  const resolvedBefore = new Date(Date.now() - SPRINT_RED_RESOLVED_MS).toISOString();
  const items: InboxItem[] = [];
  for (const row of rows) {
    const session = latest.get(row.id) ?? null;
    if (session?.state === "done" && session.updatedAt < resolvedBefore) continue;
    items.push({
      kind: "sprint-red",
      at: row.mergeVerifiedAt ?? row.updatedAt,
      task: toInboxTask(row, repos),
      buildUrl: row.baseBuildUrl,
      session: session ? toInboxSession(session) : null,
    });
  }
  return items;
}

/** Backlog tasks with a repo and no PR that no session is working on: the one chore that stays manual. */
async function readyToStart(categories: StatusCategory[]): Promise<InboxItem[]> {
  const activeStates = sql.join(ACTIVE_STATES.map((s) => sql`${s}`), sql`, `);
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        statusIn(categories, "Backlog"),
        isNotNull(tasks.repositoryId),
        isNull(tasks.prNumber),
        sql`COALESCE(${tasks.onIce}, 0) = 0`,
        sql`NOT EXISTS (SELECT 1 FROM claude_sessions WHERE task_id = ${tasks.id} AND state IN (${activeStates}))`,
      ),
    );
  const repos = await buildRepoMap(rows);
  return rows.map((row) => ({ kind: "ready-to-start", at: row.updatedAt, task: toInboxTask(row, repos) }));
}
