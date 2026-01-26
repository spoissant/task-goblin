import { sql, or, and, isNotNull, isNull, eq, asc } from "drizzle-orm";
import { db } from "../../db";
import { tasks, settings, statusCategories, taskFilters } from "../../db/schema";

/**
 * Status Category - color + completion state + display order
 */
export interface StatusCategory {
  id: number;
  name: string;
  color: string;
  done: boolean;
  displayOrder: number;
  jiraMappings: string[];
}

/**
 * Task Filter - filter bar entries with position
 */
export interface TaskFilter {
  id: number;
  name: string;
  position: number;
  jiraMappings: string[];
}

/**
 * Combined status settings response
 */
export interface StatusSettings {
  categories: StatusCategory[];
  filters: TaskFilter[];
  defaultColor: string;
}

// Default values
const DEFAULT_COLOR = "bg-slate-500";

// Default categories when no data exists
const DEFAULT_CATEGORIES: Omit<StatusCategory, "id">[] = [
  { name: "Backlog", color: "bg-slate-500", done: false, displayOrder: 0, jiraMappings: ["To Do", "Open", "Backlog", "On Hold"] },
  { name: "In Progress", color: "bg-fuchsia-500", done: false, displayOrder: 1, jiraMappings: ["In Progress"] },
  { name: "Code Review", color: "bg-yellow-600", done: false, displayOrder: 2, jiraMappings: ["Code Review", "Review"] },
  { name: "Ready for Test", color: "bg-blue-600", done: false, displayOrder: 3, jiraMappings: ["Ready for Test"] },
  { name: "QA", color: "bg-blue-600", done: false, displayOrder: 4, jiraMappings: ["QA", "Design QA"] },
  { name: "Ready to Merge", color: "bg-green-700", done: false, displayOrder: 5, jiraMappings: ["Ready to Merge"] },
  { name: "Done", color: "bg-green-700", done: true, displayOrder: 6, jiraMappings: ["Done", "Closed", "Ready to Prod", "Cancelled"] },
  { name: "Blocked", color: "bg-red-500", done: false, displayOrder: 7, jiraMappings: ["Blocked"] },
];

// Default filters when no data exists
const DEFAULT_FILTERS: Omit<TaskFilter, "id">[] = [
  { name: "Active", position: 0, jiraMappings: ["In Progress", "Code Review", "Ready for Test", "QA", "Design QA", "Review"] },
  { name: "Review", position: 1, jiraMappings: ["Ready to Merge"] },
  { name: "Backlog", position: 2, jiraMappings: ["To Do", "Open", "Backlog", "On Hold", "Blocked"] },
];

// Cache for status data
let categoriesCache: StatusCategory[] | null = null;
let filtersCache: TaskFilter[] | null = null;
let defaultColorCache: string | null = null;

/**
 * Invalidate all caches (call when config is updated)
 */
export function invalidateStatusConfigCache(): void {
  categoriesCache = null;
  filtersCache = null;
  defaultColorCache = null;
}

// Helper to parse jiraMappings JSON
function parseJiraMappings(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/**
 * Get all status categories from database
 */
export async function getStatusCategories(): Promise<StatusCategory[]> {
  if (categoriesCache !== null) {
    return categoriesCache;
  }

  const rows = await db
    .select()
    .from(statusCategories)
    .orderBy(asc(statusCategories.displayOrder));

  if (rows.length === 0) {
    // Seed with defaults
    await seedDefaultCategories();
    return getStatusCategories();
  }

  categoriesCache = rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    done: row.done === 1,
    displayOrder: row.displayOrder,
    jiraMappings: parseJiraMappings(row.jiraMappings),
  }));

  return categoriesCache;
}

/**
 * Get all task filters from database
 */
export async function getTaskFilters(): Promise<TaskFilter[]> {
  if (filtersCache !== null) {
    return filtersCache;
  }

  const rows = await db
    .select()
    .from(taskFilters)
    .orderBy(asc(taskFilters.position));

  if (rows.length === 0) {
    // Seed with defaults
    await seedDefaultFilters();
    return getTaskFilters();
  }

  filtersCache = rows.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    jiraMappings: parseJiraMappings(row.jiraMappings),
  }));

  return filtersCache;
}

/**
 * Get default color for unmapped statuses
 */
export async function getDefaultStatusColor(): Promise<string> {
  if (defaultColorCache !== null) {
    return defaultColorCache;
  }

  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "status_default_color"));

  defaultColorCache = result[0]?.value || DEFAULT_COLOR;
  return defaultColorCache;
}

/**
 * Get combined status settings
 */
export async function getStatusSettings(): Promise<StatusSettings> {
  const [categories, filters, defaultColor] = await Promise.all([
    getStatusCategories(),
    getTaskFilters(),
    getDefaultStatusColor(),
  ]);

  return { categories, filters, defaultColor };
}

/**
 * Save status categories (bulk replace)
 */
export async function saveStatusCategories(categories: Omit<StatusCategory, "id">[]): Promise<void> {
  await db.delete(statusCategories);

  if (categories.length > 0) {
    await db.insert(statusCategories).values(
      categories.map((cat) => ({
        name: cat.name,
        color: cat.color,
        done: cat.done ? 1 : 0,
        displayOrder: cat.displayOrder,
        jiraMappings: JSON.stringify(cat.jiraMappings),
      }))
    );
  }

  invalidateStatusConfigCache();
}

/**
 * Save task filters (bulk replace)
 */
export async function saveTaskFilters(filters: Omit<TaskFilter, "id">[]): Promise<void> {
  await db.delete(taskFilters);

  if (filters.length > 0) {
    await db.insert(taskFilters).values(
      filters.map((filter) => ({
        name: filter.name,
        position: filter.position,
        jiraMappings: JSON.stringify(filter.jiraMappings),
      }))
    );
  }

  invalidateStatusConfigCache();
}

/**
 * Save default color
 */
export async function saveDefaultColor(color: string): Promise<void> {
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "status_default_color"));

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value: color })
      .where(eq(settings.key, "status_default_color"));
  } else {
    await db
      .insert(settings)
      .values({ key: "status_default_color", value: color });
  }

  invalidateStatusConfigCache();
}

/**
 * Seed default categories
 */
async function seedDefaultCategories(): Promise<void> {
  await db.insert(statusCategories).values(
    DEFAULT_CATEGORIES.map((cat) => ({
      name: cat.name,
      color: cat.color,
      done: cat.done ? 1 : 0,
      displayOrder: cat.displayOrder,
      jiraMappings: JSON.stringify(cat.jiraMappings),
    }))
  );
}

/**
 * Seed default filters
 */
async function seedDefaultFilters(): Promise<void> {
  await db.insert(taskFilters).values(
    DEFAULT_FILTERS.map((filter) => ({
      name: filter.name,
      position: filter.position,
      jiraMappings: JSON.stringify(filter.jiraMappings),
    }))
  );
}

// Helper to normalize status name (for comparison)
function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/**
 * Build reverse mapping from status name (normalized) -> category
 */
export async function buildStatusCategoryMap(): Promise<Map<string, StatusCategory>> {
  const categories = await getStatusCategories();
  const map = new Map<string, StatusCategory>();

  for (const category of categories) {
    // Map category name to itself
    map.set(normalizeStatus(category.name), category);

    // Map all jiraMappings to this category
    for (const jiraStatus of category.jiraMappings) {
      map.set(normalizeStatus(jiraStatus), category);
    }
  }

  return map;
}

/**
 * Resolve a status to its category
 */
export async function resolveStatusCategory(status: string): Promise<StatusCategory | null> {
  const map = await buildStatusCategoryMap();
  const normalized = normalizeStatus(status);
  return map.get(normalized) || null;
}

/**
 * Get color for a status (returns defaultColor if not mapped)
 */
export async function getStatusColor(status: string): Promise<string> {
  const category = await resolveStatusCategory(status);
  if (category) {
    return category.color;
  }
  return getDefaultStatusColor();
}

/**
 * Check if a status is completed (done=true in its category)
 */
export async function isStatusCompleted(status: string): Promise<boolean> {
  const category = await resolveStatusCategory(status);
  return category?.done ?? false;
}

/**
 * Get all completed status names (for filtering)
 * Returns all status names (category names + jira mappings) where done=true
 */
export async function getCompletedStatusNames(): Promise<string[]> {
  const categories = await getStatusCategories();
  const names: string[] = [];

  for (const category of categories) {
    if (category.done) {
      // Add category name
      names.push(category.name.toLowerCase());

      // Add all mapped statuses
      for (const jiraStatus of category.jiraMappings) {
        names.push(jiraStatus.toLowerCase());
      }
    }
  }

  return [...new Set(names)]; // Deduplicate
}

/**
 * Get all status categories (for manual task creation/editing)
 * Returns categories sorted by displayOrder
 */
export async function getAllStatuses(): Promise<StatusCategory[]> {
  return getStatusCategories();
}

// For backwards compatibility
export const getSelectableStatuses = getAllStatuses;

/**
 * Validate if a status is valid for manual tasks
 */
export async function isStatusValid(status: string): Promise<boolean> {
  const categories = await getStatusCategories();
  const s = normalizeStatus(status);
  return categories.some((c) => normalizeStatus(c.name) === s);
}

// For backwards compatibility
export const isStatusSelectable = isStatusValid;

/**
 * Get SQL condition for completed tasks based on dynamic config
 */
export async function getCompletedConditionAsync(): Promise<ReturnType<typeof or>> {
  const completedStatuses = await getCompletedStatusNames();

  // Generate parameterized SQL for status IN check (case-insensitive)
  const jiraStatusInCondition = () => {
    if (completedStatuses.length === 0) {
      return sql`1 = 0`; // No completed statuses configured
    }
    return sql`LOWER(${tasks.status}) IN (${sql.join(completedStatuses.map((s) => sql`${s}`), sql`, `)})`;
  };

  return or(
    // Jira-only completed: jiraKey set, no prNumber, status in completed list
    and(
      isNotNull(tasks.jiraKey),
      isNull(tasks.prNumber),
      jiraStatusInCondition()
    ),
    // PR-only completed: prNumber set, no jiraKey, prState = merged or closed
    and(
      isNotNull(tasks.prNumber),
      isNull(tasks.jiraKey),
      or(eq(tasks.prState, "merged"), eq(tasks.prState, "closed"))
    ),
    // Both completed: jiraKey AND prNumber set, both conditions met
    and(
      isNotNull(tasks.jiraKey),
      isNotNull(tasks.prNumber),
      jiraStatusInCondition(),
      eq(tasks.prState, "merged")
    ),
    // Manual completed: no jiraKey, no prNumber, status in completed list
    and(
      isNull(tasks.jiraKey),
      isNull(tasks.prNumber),
      jiraStatusInCondition()
    )
  );
}

/**
 * Get SQL condition for non-completed tasks (inverse of completed)
 */
export async function getNotCompletedConditionAsync(): Promise<ReturnType<typeof sql>> {
  const completedCondition = await getCompletedConditionAsync();
  return sql`NOT (${completedCondition})`;
}

/**
 * Generate SQL CASE expression for status ordering from categories
 * Maps all jiraMappings to their corresponding displayOrder values
 */
export async function getStatusOrderExprAsync(): Promise<ReturnType<typeof sql>> {
  const categories = await getStatusCategories();
  const defaultOrder = 999;

  // Build CASE expression from categories
  const cases: ReturnType<typeof sql>[] = [];

  for (const category of categories) {
    // Collect all status names to map (category name + jiraMappings)
    const allNames: string[] = [category.name, ...category.jiraMappings];

    // Build list of normalized variants (both space and underscore versions)
    const variants: string[] = [];
    for (const name of allNames) {
      const normalized = normalizeStatus(name);
      variants.push(normalized);
      const underscored = normalized.replace(/ /g, "_");
      if (underscored !== normalized) {
        variants.push(underscored);
      }
    }

    // Deduplicate
    const uniqueVariants = [...new Set(variants)];

    if (uniqueVariants.length === 1) {
      cases.push(sql`WHEN LOWER(${tasks.status}) = ${uniqueVariants[0]} THEN ${category.displayOrder}`);
    } else {
      cases.push(sql`WHEN LOWER(${tasks.status}) IN (${sql.join(uniqueVariants.map((v) => sql`${v}`), sql`, `)}) THEN ${category.displayOrder}`);
    }
  }

  // Default case for unknown statuses
  cases.push(sql`ELSE ${defaultOrder}`);

  return sql`CASE ${sql.join(cases, sql` `)} END`;
}

// ============================================
// SYNCHRONOUS VERSIONS (for backwards compatibility)
// These use hardcoded defaults
// ============================================

/**
 * Legacy: Valid statuses for manually-created tasks
 * @deprecated Use getSelectableStatuses() instead
 */
export const MANUAL_TASK_STATUSES = ["To Do", "In Progress", "Code Review", "QA", "Done", "Blocked", "Ready to Merge"];

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
  return sql`LOWER(${tasks.status}) IN (${sql.join(JIRA_COMPLETED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;
}

// Helper to generate parameterized SQL for status NOT IN check (case-insensitive)
export function jiraStatusNotInCondition() {
  return sql`LOWER(${tasks.status}) NOT IN (${sql.join(JIRA_COMPLETED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;
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
    // PR-only completed: prNumber set, no jiraKey, prState = merged or closed
    and(
      isNotNull(tasks.prNumber),
      isNull(tasks.jiraKey),
      or(eq(tasks.prState, "merged"), eq(tasks.prState, "closed"))
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
      sql`LOWER(${tasks.status}) = 'done'`
    )
  );
}

// SQL condition for non-completed tasks (inverse of completed)
export function getNotCompletedCondition() {
  return sql`NOT (${getCompletedCondition()})`;
}

// SQL CASE expression for status ordering (lower = higher priority)
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

