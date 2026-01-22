import { sql, or, and, isNotNull, isNull, eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks, settings } from "../../db/schema";

/**
 * Status configuration stored in settings as JSON
 */
export interface StatusConfig {
  name: string;          // Display name (our status, not necessarily Jira's)
  color: string | null;  // Tailwind class, null = use default
  order: number;         // Sort position
  isCompleted: boolean;  // Show in Completed vs Tasks page
  isDefault?: boolean;   // Default status for unknown statuses (exactly one should be true)
  filter?: string | null; // Filter group for dashboard tabs (null = not in any filter)
  jiraMapping?: string[]; // Jira statuses that map to this status
}

// Default statuses when no config exists (for backwards compatibility)
const DEFAULT_STATUS_CONFIG: StatusConfig[] = [
  { name: "Backlog", color: "bg-slate-500", order: 10, isCompleted: false, isDefault: true, filter: "Backlog", jiraMapping: ["To Do", "Open", "Reopened", "Accepted", "Backlog", "On Hold"] },
  { name: "In Progress", color: "bg-fuchsia-500", order: 9, isCompleted: false, isDefault: false, filter: "Active", jiraMapping: ["In Progress"] },
  { name: "Code Review", color: "bg-yellow-600", order: 8, isCompleted: false, isDefault: false, filter: "Active", jiraMapping: ["Code Review", "Review"] },
  { name: "QA", color: "bg-blue-600", order: 7, isCompleted: false, isDefault: false, filter: "Active", jiraMapping: ["Ready for Test", "QA", "Testing"] },
  { name: "Ready to Merge", color: "bg-green-700", order: 6, isCompleted: false, isDefault: false, filter: "Review", jiraMapping: ["Ready to Merge"] },
  { name: "Blocked", color: "bg-red-500", order: 5, isCompleted: false, isDefault: false, filter: "Backlog", jiraMapping: ["Blocked"] },
  { name: "Done", color: "bg-green-700", order: 0, isCompleted: true, isDefault: false, filter: null, jiraMapping: ["Done", "Closed", "Ready to Prod", "Cancelled", "Rejected", "Completed", "Define Preventive Measures"] },
];

const DEFAULT_COLOR = "bg-slate-500";

// Cache for status config
let statusConfigCache: StatusConfig[] | null = null;
let defaultColorCache: string | null = null;

/**
 * Invalidate the status config cache (call when config is updated)
 */
export function invalidateStatusConfigCache(): void {
  statusConfigCache = null;
  defaultColorCache = null;
}

/**
 * Get status configuration from settings
 */
export async function getStatusConfig(): Promise<StatusConfig[]> {
  if (statusConfigCache !== null) {
    return statusConfigCache;
  }

  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "status_config"));

  if (result.length === 0 || !result[0].value) {
    statusConfigCache = DEFAULT_STATUS_CONFIG;
    return statusConfigCache;
  }

  try {
    statusConfigCache = JSON.parse(result[0].value) as StatusConfig[];
    return statusConfigCache;
  } catch {
    statusConfigCache = DEFAULT_STATUS_CONFIG;
    return statusConfigCache;
  }
}

/**
 * Get the default status (for unknown/deleted statuses to inherit from)
 */
export async function getDefaultStatus(): Promise<StatusConfig> {
  const config = await getStatusConfig();
  const defaultStatus = config.find(s => s.isDefault);
  // Fallback to first status if none marked as default (shouldn't happen with valid config)
  return defaultStatus || config[0] || DEFAULT_STATUS_CONFIG[0];
}

/**
 * Get default color for statuses without custom color
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
 * Save status configuration to settings
 */
export async function saveStatusConfig(config: StatusConfig[]): Promise<void> {
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "status_config"));

  const value = JSON.stringify(config);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value })
      .where(eq(settings.key, "status_config"));
  } else {
    await db
      .insert(settings)
      .values({ key: "status_config", value });
  }

  invalidateStatusConfigCache();
}

/**
 * Get all statuses (for manual task creation/editing - all are now selectable)
 */
export async function getAllStatuses(): Promise<StatusConfig[]> {
  const config = await getStatusConfig();
  return [...config].sort((a, b) => b.order - a.order);
}

// For backwards compatibility
export const getSelectableStatuses = getAllStatuses;

/**
 * Build reverse mapping from Jira status (lowercase) -> our status config
 */
export async function buildJiraStatusMap(): Promise<Map<string, StatusConfig>> {
  const config = await getStatusConfig();
  const map = new Map<string, StatusConfig>();

  for (const status of config) {
    // Map our status name to itself
    map.set(normalizeStatus(status.name), status);

    // Map all jiraMapping entries to this status
    if (status.jiraMapping) {
      for (const jiraStatus of status.jiraMapping) {
        map.set(normalizeStatus(jiraStatus), status);
      }
    }
  }

  return map;
}

/**
 * Resolve a Jira/task status to our status config
 * Returns the matching config, or the default status config if not found
 */
export async function resolveStatusConfig(status: string): Promise<StatusConfig> {
  const map = await buildJiraStatusMap();
  const normalized = normalizeStatus(status);
  const resolved = map.get(normalized);

  if (resolved) {
    return resolved;
  }

  // Fallback to default status
  return getDefaultStatus();
}

/**
 * Get completed status names (for filtering)
 * Returns all Jira status names (from jiraMapping) and our status names that are completed
 */
export async function getCompletedStatusNames(): Promise<string[]> {
  const config = await getStatusConfig();
  const names: string[] = [];

  for (const status of config) {
    if (status.isCompleted) {
      // Add our status name
      names.push(status.name.toLowerCase());

      // Add all mapped Jira statuses
      if (status.jiraMapping) {
        for (const jiraStatus of status.jiraMapping) {
          names.push(jiraStatus.toLowerCase());
        }
      }
    }
  }

  return [...new Set(names)]; // Deduplicate
}

/**
 * Validate if a status is valid for manual tasks (any of our defined statuses)
 */
export async function isStatusValid(status: string): Promise<boolean> {
  const config = await getStatusConfig();
  const s = normalizeStatus(status);
  // Allow any of our status names (including completed ones like "Done")
  return config.some(c => normalizeStatus(c.name) === s);
}

// For backwards compatibility
export const isStatusSelectable = isStatusValid;

// Helper to normalize status name (for comparison)
function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/**
 * Get SQL condition for checking if a task is completed based on its type
 * This now uses dynamic config for Jira completed statuses
 */
export async function getCompletedConditionAsync(): Promise<ReturnType<typeof or>> {
  const completedStatuses = await getCompletedStatusNames();

  // Generate parameterized SQL for status IN check (case-insensitive)
  const jiraStatusInCondition = () => {
    if (completedStatuses.length === 0) {
      return sql`1 = 0`; // No completed statuses configured
    }
    return sql`LOWER(${tasks.status}) IN (${sql.join(completedStatuses.map(s => sql`${s}`), sql`, `)})`;
  };

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
 * Generate SQL CASE expression for status ordering from config
 * Maps all jiraMapping statuses to their corresponding order values
 */
export async function getStatusOrderExprAsync(): Promise<ReturnType<typeof sql>> {
  const config = await getStatusConfig();
  const defaultStatus = config.find(s => s.isDefault);
  const defaultOrder = defaultStatus?.order ?? 999;

  // Build CASE expression from config
  const cases: ReturnType<typeof sql>[] = [];

  for (const status of config) {
    // Collect all status names to map (our name + jiraMapping)
    const allNames: string[] = [status.name];
    if (status.jiraMapping) {
      allNames.push(...status.jiraMapping);
    }

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
      cases.push(sql`WHEN LOWER(${tasks.status}) = ${uniqueVariants[0]} THEN ${status.order}`);
    } else {
      cases.push(sql`WHEN LOWER(${tasks.status}) IN (${sql.join(uniqueVariants.map(v => sql`${v}`), sql`, `)}) THEN ${status.order}`);
    }
  }

  // Default case for unknown statuses (use default status's order)
  cases.push(sql`ELSE ${defaultOrder}`);

  return sql`CASE ${sql.join(cases, sql` `)} END`;
}

// ============================================
// SYNCHRONOUS VERSIONS (for backwards compatibility)
// These use the hardcoded defaults if config isn't loaded
// ============================================

/**
 * Legacy: Valid statuses for manually-created tasks (no Jira/GitHub integration).
 * Jira-synced tasks store raw Jira statuses (e.g., "In Progress", "Ready to Prod")
 * and are not validated against this list.
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
      sql`LOWER(${tasks.status}) = 'done'`
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
