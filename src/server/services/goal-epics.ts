import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { goals, tasks } from "../../db/schema";

/** The epic keys of a goal row (stored as a JSON array). */
export function parseEpicKeys(raw: string): string[] {
  try {
    const keys: unknown = JSON.parse(raw);
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

/** The active goal an epic is tied to, if any. */
async function findGoalIdByEpic(epicKey: string | null): Promise<number | null> {
  if (!epicKey) return null;
  const rows = await db.select({ id: goals.id, epicKeys: goals.epicKeys }).from(goals).where(eq(goals.archived, 0));
  return rows.find((goal) => parseEpicKeys(goal.epicKeys).includes(epicKey))?.id ?? null;
}

/**
 * The goal an issue belongs to through its epic. A sub-task has no epic of its own: it follows
 * its parent's, when the parent is a task here.
 */
export async function findGoalIdForIssue(issue: { epicKey: string | null; parentKey: string | null }): Promise<number | null> {
  let epicKey = issue.epicKey;
  if (!epicKey && issue.parentKey) {
    const parent = await db.select({ epicKey: tasks.epicKey }).from(tasks).where(eq(tasks.jiraKey, issue.parentKey));
    epicKey = parent[0]?.epicKey ?? null;
  }
  return findGoalIdByEpic(epicKey);
}

/** Moves a task's unassigned sub-tasks into the goal. */
export async function pullSubtasksIntoGoal(parentKey: string, goalId: number): Promise<void> {
  await db.update(tasks).set({ goalId }).where(and(isNull(tasks.goalId), eq(tasks.parentKey, parentKey)));
}

/** Moves the unassigned tasks of the given epics, and their sub-tasks, into the goal. Tasks already in a goal stay where they are. */
export async function pullEpicTasksIntoGoal(goalId: number, epicKeys: string[]): Promise<void> {
  if (epicKeys.length === 0) return;
  const epicTaskKeys = db.select({ key: tasks.jiraKey }).from(tasks).where(inArray(tasks.epicKey, epicKeys));
  await db
    .update(tasks)
    .set({ goalId })
    .where(and(isNull(tasks.goalId), or(inArray(tasks.epicKey, epicKeys), inArray(tasks.parentKey, epicTaskKeys))));
}
