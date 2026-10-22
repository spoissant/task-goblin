/**
 * The other tasks a bulk chore session covers: the session row keeps the
 * first task, a link row each of the rest with the trigger state it started
 * on, so the scheduler won't run the chore on them again. A linked task counts
 * as having the session, for busy checks and in the task's session list.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, claudeSessionTasks } from "../../db/schema";
import { ACTIVE_SESSION_STATES } from "../../shared/types";

type SessionTaskLink = { taskId: number; triggerFingerprint: string | null };

/** Where-clause for the sessions on any of these tasks, their own or a batch they are linked into. */
export function coversTasks(taskIds: number[]) {
  const linked = db
    .select({ id: claudeSessionTasks.sessionId })
    .from(claudeSessionTasks)
    .where(inArray(claudeSessionTasks.taskId, taskIds));
  return or(inArray(claudeSessions.taskId, taskIds), inArray(claudeSessions.id, linked));
}

/** Where-clause for the sessions that haven't finished: waiting to start, or running. */
export function isActive() {
  return inArray(claudeSessions.state, [...ACTIVE_SESSION_STATES]);
}

/** The session keeping the task busy, its own or a bulk run's it is linked into; null when it has none. */
export async function findActiveSession(taskId: number): Promise<{ id: number; state: string } | null> {
  const [row] = await db
    .select({ id: claudeSessions.id, state: claudeSessions.state })
    .from(claudeSessions)
    .where(and(coversTasks([taskId]), isActive()))
    .limit(1);
  return row ?? null;
}

/** Tasks with an active session, their own or a bulk run's they are linked into. */
export async function activeTaskIds(): Promise<Set<number>> {
  const rows = await db.select({ id: claudeSessions.id, taskId: claudeSessions.taskId }).from(claudeSessions).where(isActive());
  const links = await sessionLinks(rows.map((r) => r.id));
  return new Set(rows.flatMap((r) => [r.taskId, ...(links.get(r.id) ?? []).map((l) => l.taskId)]).filter((id) => id !== null));
}

export async function linkSessionTasks(sessionId: number, links: SessionTaskLink[]): Promise<void> {
  if (links.length === 0) return;
  await db.insert(claudeSessionTasks).values(links.map((l) => ({ sessionId, ...l })));
}

/** Each session's link rows, by session id. */
export async function sessionLinks(sessionIds: number[]): Promise<Map<number, SessionTaskLink[]>> {
  const map = new Map<number, SessionTaskLink[]>();
  if (sessionIds.length === 0) return map;
  const rows = await db
    .select()
    .from(claudeSessionTasks)
    .where(inArray(claudeSessionTasks.sessionId, sessionIds))
    .orderBy(claudeSessionTasks.id);
  for (const { sessionId, taskId, triggerFingerprint } of rows) {
    map.set(sessionId, [...(map.get(sessionId) ?? []), { taskId, triggerFingerprint }]);
  }
  return map;
}

/** Every task the session covers: its own, then the linked ones. */
export async function coveredTaskIds(session: { id: number; taskId: number | null }): Promise<number[]> {
  const links = (await sessionLinks([session.id])).get(session.id) ?? [];
  return [...(session.taskId === null ? [] : [session.taskId]), ...links.map((l) => l.taskId)];
}

/** Hand a merged-away task's links to the task it merged into. */
export async function moveSessionLinks(tx: Pick<typeof db, "update">, sourceId: number, targetId: number): Promise<void> {
  await tx.update(claudeSessionTasks).set({ taskId: targetId }).where(eq(claudeSessionTasks.taskId, sourceId));
}
