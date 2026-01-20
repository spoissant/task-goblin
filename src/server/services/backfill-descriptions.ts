import { eq, like } from "drizzle-orm";
import { convert as adfToMd } from "adf-to-md";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { now } from "../lib/timestamp";

export interface BackfillResult {
  total: number;
  converted: number;
  failed: number;
}

export async function backfillDescriptions(): Promise<BackfillResult> {
  // Find tasks with JSON-looking descriptions (ADF format starts with {"type":"doc")
  const tasksWithAdf = await db
    .select({ id: tasks.id, description: tasks.description })
    .from(tasks)
    .where(like(tasks.description, '{"type":"doc"%'));

  let converted = 0;
  let failed = 0;

  for (const task of tasksWithAdf) {
    if (!task.description) continue;

    try {
      const adf = JSON.parse(task.description);
      const { result } = adfToMd(adf);

      if (result) {
        await db
          .update(tasks)
          .set({
            description: result,
            updatedAt: now(),
          })
          .where(eq(tasks.id, task.id));
        converted++;
      }
    } catch {
      // Skip tasks that can't be parsed/converted
      failed++;
    }
  }

  return {
    total: tasksWithAdf.length,
    converted,
    failed,
  };
}
