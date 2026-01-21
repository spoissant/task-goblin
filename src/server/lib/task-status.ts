import { sql, or, and, isNotNull, isNull, eq } from "drizzle-orm";
import { tasks } from "../../db/schema";

export const VALID_STATUSES = ["todo", "in_progress", "code_review", "qa", "done", "blocked", "ready_to_merge"];

// Jira statuses that indicate completion (case-insensitive, stored lowercase)
export const JIRA_COMPLETED_STATUSES = [
  "ready to prod",
  "completed",
  "done",
  "closed",
  "cancelled",
  "rejected",
  "define preventive measures",
];

// Helper to generate parameterized SQL for status IN check (case-insensitive)
function jiraStatusInCondition() {
  return sql`LOWER(${tasks.status}) IN (${sql.join(JIRA_COMPLETED_STATUSES.map(s => sql`${s}`), sql`, `)})`;
}

// Helper to generate parameterized SQL for status NOT IN check (case-insensitive)
export function jiraStatusNotInCondition() {
  return sql`LOWER(${tasks.status}) NOT IN (${sql.join(JIRA_COMPLETED_STATUSES.map(s => sql`${s}`), sql`, `)})`;
}

// SQL condition for checking if a task is completed based on its type
export function getCompletedCondition() {
  return or(
    // Jira-only completed: jiraKey set, no prNumber, status in completed list
    and(
      isNotNull(tasks.jiraKey),
      isNull(tasks.prNumber),
      jiraStatusInCondition()
    ),
    // PR-only completed: prNumber set, no jiraKey, prState = merged
    and(
      isNotNull(tasks.prNumber),
      isNull(tasks.jiraKey),
      eq(tasks.prState, "merged")
    ),
    // Both completed: jiraKey AND prNumber set, both conditions met
    and(
      isNotNull(tasks.jiraKey),
      isNotNull(tasks.prNumber),
      jiraStatusInCondition(),
      eq(tasks.prState, "merged")
    ),
    // Manual completed: no jiraKey, no prNumber, status = done
    and(
      isNull(tasks.jiraKey),
      isNull(tasks.prNumber),
      eq(tasks.status, "done")
    )
  );
}

// SQL condition for non-completed tasks (inverse of completed)
export function getNotCompletedCondition() {
  return sql`NOT (${getCompletedCondition()})`;
}

// SQL CASE expression for status ordering (lower = higher priority)
// Handles both underscore and space variants (e.g., "code_review" and "code review")
export const statusOrderExpr = sql`CASE
  WHEN LOWER(${tasks.status}) = 'done' THEN 0
  WHEN LOWER(${tasks.status}) = 'cancelled' THEN 1
  WHEN LOWER(${tasks.status}) = 'rejected' THEN 2
  WHEN LOWER(${tasks.status}) = 'closed' THEN 3
  WHEN LOWER(${tasks.status}) IN ('ready to prod', 'ready_to_prod') THEN 4
  WHEN LOWER(${tasks.status}) IN ('ready to merge', 'ready_to_merge') THEN 5
  WHEN LOWER(${tasks.status}) = 'qa' THEN 6
  WHEN LOWER(${tasks.status}) IN ('ready for test', 'ready_for_test') THEN 7
  WHEN LOWER(${tasks.status}) IN ('code review', 'code_review') THEN 8
  WHEN LOWER(${tasks.status}) IN ('in progress', 'in_progress') THEN 9
  WHEN LOWER(${tasks.status}) IN ('to do', 'todo') THEN 10
  WHEN LOWER(${tasks.status}) = 'accepted' THEN 11
  WHEN LOWER(${tasks.status}) = 'backlog' THEN 12
  WHEN LOWER(${tasks.status}) IN ('on hold', 'on_hold') THEN 13
  ELSE 14
END`;
