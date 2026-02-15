import { db } from "../../db";
import { logs } from "../../db/schema";
import { now } from "./timestamp";

export interface FieldDiff {
  field: string;
  old: string | null;
  new: string | null;
}

export function generateTaskDiff(
  oldTask: Record<string, unknown>,
  newData: Record<string, unknown>,
  fields: readonly string[]
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of fields) {
    const oldVal = oldTask[field] ?? null;
    const newVal = newData[field] ?? null;
    // Convert to string for comparison
    const oldStr = oldVal === null ? null : String(oldVal);
    const newStr = newVal === null ? null : String(newVal);
    if (oldStr !== newStr) {
      diffs.push({ field, old: oldStr, new: newStr });
    }
  }
  return diffs;
}

export function formatDiffLog(
  diffs: FieldDiff[],
  largeFields: readonly string[] = []
): string {
  const lines = ["# Task updated"];
  for (const diff of diffs) {
    if (largeFields.includes(diff.field)) {
      lines.push(`- ${diff.field}: (changed)`);
    } else {
      lines.push(`- ${diff.field}: ${diff.old ?? "null"} -> ${diff.new ?? "null"}`);
    }
  }
  return lines.join("\n");
}

/**
 * Compare old and new task data, insert a log entry if changed.
 * Returns true if changes were found and logged.
 */
export async function logDiffsIfChanged(
  oldTask: Record<string, unknown>,
  newData: Record<string, unknown>,
  opts: {
    taskId: number;
    trackedFields: readonly string[];
    largeFields?: readonly string[];
    source: string;
  },
): Promise<boolean> {
  const diffs = generateTaskDiff(oldTask, newData, opts.trackedFields);
  if (diffs.length === 0) return false;

  await db.insert(logs).values({
    taskId: opts.taskId,
    content: formatDiffLog(diffs, opts.largeFields),
    source: opts.source,
    createdAt: now(),
  });
  return true;
}
