import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, settings } from "../../db/schema";

// Status name mapping from underscore format to Jira format
const STATUS_MIGRATION_MAP: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  code_review: "Code Review",
  qa: "QA",
  ready_to_merge: "Ready to Merge",
  ready_to_prod: "Ready to Prod",
  done: "Done",
  blocked: "Blocked",
  ready_for_test: "Ready for Test",
  on_hold: "On Hold",
};

/**
 * Migrate existing underscore statuses to Jira format
 * This runs once at startup if not already done
 */
export async function migrateTaskStatuses(): Promise<void> {
  // Check if migration has already been done
  const migrationKey = "status_migration_v1";
  const migrationCheck = await db
    .select()
    .from(settings)
    .where(eq(settings.key, migrationKey));

  if (migrationCheck.length > 0) {
    // Migration already done
    return;
  }

  console.log("Running status migration...");

  let migratedCount = 0;

  // Get all tasks with underscore statuses
  for (const [underscoreStatus, jiraStatus] of Object.entries(STATUS_MIGRATION_MAP)) {
    const result = await db
      .update(tasks)
      .set({ status: jiraStatus })
      .where(eq(tasks.status, underscoreStatus))
      .returning({ id: tasks.id });

    migratedCount += result.length;
  }

  // Mark migration as done
  await db.insert(settings).values({
    key: migrationKey,
    value: new Date().toISOString(),
  });

  console.log(`Status migration complete. Updated ${migratedCount} task(s).`);
}
