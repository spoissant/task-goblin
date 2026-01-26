import { db } from "../../db";
import { logs } from "../../db/schema";
import { now } from "./timestamp";

export type LogSource = "deploy" | "sync" | "system";

/**
 * Log an activity message for a task.
 */
export async function logActivity(
  taskId: number,
  message: string,
  source: LogSource
): Promise<void> {
  await db.insert(logs).values({
    taskId,
    content: message,
    createdAt: now(),
    source,
  });
}
