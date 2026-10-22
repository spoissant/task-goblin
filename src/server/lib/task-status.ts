import { sql, or, and, isNotNull, isNull, eq, asc } from "drizzle-orm";
import { db } from "../../db";
import { tasks, settings, statusCategories } from "../../db/schema";

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
 * Combined status settings response
 */
export interface StatusSettings {
  categories: StatusCategory[];
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

// Cache for status data
let categoriesCache: StatusCategory[] | null = null;
let defaultColorCache: string | null = null;

/**
 * Invalidate all caches (call when config is updated)
 */
export function invalidateStatusConfigCache(): void {
  categoriesCache = null;
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
  const [categories, defaultColor] = await Promise.all([
    getStatusCategories(),
    getDefaultStatusColor(),
  ]);

  return { categories, defaultColor };
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

/** The status names a category covers, lower-cased: its own name and its Jira mappings. */
export function statusNamesOf(category: Pick<StatusCategory, "name" | "jiraMappings">): string[] {
  return [...new Set([category.name, ...category.jiraMappings].map((name) => name.toLowerCase()))];
}

/**
 * Get all completed status names (for filtering)
 * Returns all status names (category names + jira mappings) where done=true
 */
export async function getCompletedStatusNames(): Promise<string[]> {
  const categories = await getStatusCategories();
  const names: string[] = [];

  for (const category of categories) {
    if (category.done) names.push(...statusNamesOf(category));
  }

  return [...new Set(names)];
}

/**
 * Validate if a status is valid for manual tasks
 */
export async function isStatusValid(status: string): Promise<boolean> {
  const categories = await getStatusCategories();
  const s = status.toLowerCase();
  return categories.some((c) => c.name.toLowerCase() === s);
}


/**
 * Get SQL condition for completed tasks based on dynamic config
 */
export async function getCompletedCondition(): Promise<ReturnType<typeof or>> {
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
      or(eq(tasks.prState, "merged"), eq(tasks.prState, "closed"))
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
export async function getNotCompletedCondition(): Promise<ReturnType<typeof sql>> {
  const completedCondition = await getCompletedCondition();
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
    const uniqueNames = statusNamesOf(category);

    if (uniqueNames.length === 1) {
      cases.push(sql`WHEN LOWER(${tasks.status}) = ${uniqueNames[0]} THEN ${category.displayOrder}`);
    } else {
      cases.push(sql`WHEN LOWER(${tasks.status}) IN (${sql.join(uniqueNames.map((v) => sql`${v}`), sql`, `)}) THEN ${category.displayOrder}`);
    }
  }

  // Default case for unknown statuses
  cases.push(sql`ELSE ${defaultOrder}`);

  return sql`CASE ${sql.join(cases, sql` `)} END`;
}

/**
 * Full task ordering: by status display order first, then within each status
 * group high-priority tasks come first and on-ice tasks last.
 * Spread into drizzle's `.orderBy(...)`.
 */
export async function getTaskOrderExprsAsync(): Promise<ReturnType<typeof sql>[]> {
  const statusOrder = await getStatusOrderExprAsync();
  return [
    statusOrder,
    sql`COALESCE(${tasks.onIce}, 0) ASC`,
    sql`COALESCE(${tasks.highPriority}, 0) DESC`,
  ];
}


