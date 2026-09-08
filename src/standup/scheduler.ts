import { existsSync } from "node:fs";
import { join } from "node:path";
import { SNAPSHOT_DIR, writeSnapshot } from "./service";
import { localDate } from "./snapshot";

/** How often to re-check that today's snapshot exists. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first check, so a user who opens the app and immediately
 *  hits Sync All gets a synced snapshot written first rather than a stale one
 *  written and then replaced. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export interface EnsureSnapshotOptions {
  /** True when called straight after a successful Jira/GitHub sync, which
   *  makes this snapshot authoritative for today and replaces any earlier one. */
  synced?: boolean;
  dir?: string;
  dbPath?: string;
  date?: string;
}

/**
 * Write today's snapshot, so summaries accrue without anyone remembering to
 * run anything.
 *
 * A sync always (re)writes it: the board as of your last sync today is the
 * freshest and most useful comparison point, and it means the snapshot written
 * at server start — before any sync, so holding yesterday's data — gets
 * replaced rather than standing in for today.
 *
 * Never throws. A failed snapshot must not take the API server down with it.
 */
export async function ensureTodaysSnapshot(
  reason: string,
  { synced = false, dir = SNAPSHOT_DIR, dbPath, date = localDate() }: EnsureSnapshotOptions = {},
): Promise<boolean> {
  if (!synced && existsSync(join(dir, `${date}.json`))) return false;

  try {
    const result = await writeSnapshot({
      dir,
      date,
      dbPath,
      force: synced,
      syncTriggered: synced,
    });
    if (result.written) {
      console.log(
        `[standup] snapshot ${result.date} written after ${reason} — ${result.taskCount} tasks`,
      );
    }
    return result.written;
  } catch (err) {
    console.error(`[standup] could not write today's snapshot (${reason}):`, err);
    return false;
  }
}

/** Idempotent — safe to call from a hot-reloading dev server. */
export function startStandupScheduler(): void {
  if (timer) return;

  setTimeout(() => void ensureTodaysSnapshot("server start"), STARTUP_DELAY_MS).unref?.();
  timer = setInterval(() => void ensureTodaysSnapshot("hourly check"), CHECK_INTERVAL_MS);
  // Don't hold the process open on this alone.
  timer.unref?.();
}

export function stopStandupScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
