import { eq, sql, or, and, not, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { NotFoundError } from "./errors";

/**
 * A task's epic: its own, or its parent's when it is a sub-task (Jira gives sub-tasks no epic).
 * Computed in SQL rather than stored, so it can't go stale when the parent moves to another epic.
 */
export const effectiveEpicKey = sql<string | null>`COALESCE("tasks"."epic_key", (SELECT p.epic_key FROM tasks p WHERE p.jira_key = "tasks"."parent_key"))`;

/** The ?epic= filter: tasks in that epic, sub-tasks included. */
export function buildEpicCondition(epicKey: string) {
  return sql`${effectiveEpicKey} = ${epicKey.trim().toUpperCase()}`;
}

/**
 * Build a search condition for the `title` query param. Terms combine with
 * `|` (OR) and `&` (AND, binds tighter), e.g. "tiptap | editor & ~bug" means
 * tiptap OR (editor AND NOT bug). A leading `~` negates a term. Terms are
 * trimmed and empty ones ignored.
 */
export function buildTitleSearchCondition(title: string) {
  const orGroups = title
    .split("|")
    .map((group) => {
      const terms = group
        .split("&")
        .map(buildTermCondition)
        .filter((c): c is SQL => c !== undefined);
      return terms.length > 0 ? and(...terms) : undefined;
    })
    .filter((c): c is SQL => c !== undefined);
  return orGroups.length > 0 ? or(...orGroups) : undefined;
}

/**
 * Match one search term against title/keys/branch. Columns are COALESCE'd to
 * '' so NULL values compare as non-matches instead of poisoning the OR/NOT
 * with SQL's three-valued NULL logic.
 */
function buildTermCondition(raw: string) {
  const trimmed = raw.trim();
  const negate = trimmed.startsWith("~");
  const term = negate ? trimmed.slice(1).trim() : trimmed;
  if (!term) return undefined;

  const pattern = `%${term}%`;
  const orConditions = [
    sql`COALESCE(${tasks.title}, '') LIKE ${pattern}`,
    sql`COALESCE(${tasks.jiraKey}, '') LIKE ${pattern}`,
    sql`COALESCE(${effectiveEpicKey}, '') LIKE ${pattern}`,
    sql`COALESCE(${tasks.parentKey}, '') LIKE ${pattern}`,
    sql`COALESCE(${tasks.headBranch}, '') LIKE ${pattern}`,
  ];
  const parsed = Number(term);
  if (Number.isInteger(parsed) && parsed > 0) {
    orConditions.push(eq(tasks.id, parsed));
  }

  const match = or(...orConditions)!;
  return negate ? not(match) : match;
}

/**
 * Fetch a task with its associated repository (if any).
 * Returns null if task not found.
 */
export async function getTaskWithRepository(taskId: number) {
  return (
    (await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      with: { repository: true, goal: true },
    })) ?? null
  );
}

/** The configured repository for a GitHub owner/repo (case-insensitive), or null. */
export async function findRepository(owner: string, repo: string) {
  const rows = await db
    .select()
    .from(repositories)
    .where(sql`lower(${repositories.owner}) = ${owner.toLowerCase()} AND lower(${repositories.repo}) = ${repo.toLowerCase()}`);
  return rows[0] ?? null;
}

/**
 * Build a Map of repository ID → repository for a list of tasks.
 */
export async function buildRepoMap(
  taskList: { repositoryId: number | null }[],
): Promise<Map<number, typeof repositories.$inferSelect>> {
  const repoIds = [...new Set(taskList.filter(t => t.repositoryId).map(t => t.repositoryId!))];
  const repoMap = new Map<number, typeof repositories.$inferSelect>();

  if (repoIds.length > 0) {
    const repos = await db
      .select()
      .from(repositories)
      .where(sql`${repositories.id} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`);
    for (const repo of repos) {
      repoMap.set(repo.id, repo);
    }
  }

  return repoMap;
}

export async function getTaskOrThrow(id: number): Promise<typeof tasks.$inferSelect> {
  const result = await db.select().from(tasks).where(eq(tasks.id, id));
  if (result.length === 0) throw new NotFoundError("Task", id);
  return result[0];
}
