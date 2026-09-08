import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { diffSnapshots } from "./diff";
import { renderReport } from "./render";
import { localDate, takeSnapshot, type TakeSnapshotOptions } from "./snapshot";
import type { Snapshot } from "./types";

export const SNAPSHOT_DIR = process.env.STANDUP_SNAPSHOT_DIR ?? "snapshots";
export const REPORT_DIR = process.env.STANDUP_REPORT_DIR ?? "standup";

const SNAPSHOT_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** Snapshot dates present on disk, oldest first. */
export async function listSnapshotDates(dir = SNAPSHOT_DIR): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .map((f) => f.match(SNAPSHOT_FILE)?.[1])
    .filter((d): d is string => !!d)
    .sort();
}

export async function loadSnapshot(date: string, dir = SNAPSHOT_DIR): Promise<Snapshot> {
  return JSON.parse(await Bun.file(join(dir, `${date}.json`)).text()) as Snapshot;
}

export class StandupRangeError extends Error {
  constructor(
    message: string,
    readonly available: string[],
  ) {
    super(message);
    this.name = "StandupRangeError";
  }
}

/** Default to the two newest snapshots; an explicit `to` picks the one before it. */
export function resolveRange(
  available: string[],
  from?: string | null,
  to?: string | null,
): { from: string; to: string } {
  if (available.length < 2) {
    throw new StandupRangeError(
      `Need at least two snapshots to compare (found ${available.length}).`,
      available,
    );
  }

  const resolvedTo = to ?? available.at(-1)!;
  if (!available.includes(resolvedTo)) {
    throw new StandupRangeError(`No snapshot for ${resolvedTo}.`, available);
  }

  const resolvedFrom = from ?? available[available.indexOf(resolvedTo) - 1];
  if (!resolvedFrom || !available.includes(resolvedFrom)) {
    throw new StandupRangeError(
      from ? `No snapshot for ${from}.` : `No snapshot earlier than ${resolvedTo}.`,
      available,
    );
  }
  if (resolvedFrom >= resolvedTo) {
    throw new StandupRangeError(`${resolvedFrom} is not earlier than ${resolvedTo}.`, available);
  }

  return { from: resolvedFrom, to: resolvedTo };
}

export interface StandupReport {
  from: string;
  to: string;
  available: string[];
  markdown: string;
  /** Number of tasks with at least one change, for a quick headline. */
  changedCount: number;
  takenAt: string;
  assignee: string | null;
}

export async function buildReport(options: {
  from?: string | null;
  to?: string | null;
  dir?: string;
} = {}): Promise<StandupReport> {
  const dir = options.dir ?? SNAPSHOT_DIR;
  const available = await listSnapshotDates(dir);
  const range = resolveRange(available, options.from, options.to);

  const [from, to] = await Promise.all([
    loadSnapshot(range.from, dir),
    loadSnapshot(range.to, dir),
  ]);
  const diff = diffSnapshots(from, to);

  return {
    from: range.from,
    to: range.to,
    available,
    markdown: renderReport(diff),
    changedCount: diff.changed.length,
    takenAt: to.takenAt,
    assignee: to.meta.assignee,
  };
}

export interface WriteSnapshotResult {
  date: string;
  path: string;
  written: boolean;
  taskCount: number;
  assignee: string | null;
}

export async function writeSnapshot(
  options: TakeSnapshotOptions & { dir?: string; date?: string; force?: boolean } = {},
): Promise<WriteSnapshotResult> {
  const dir = options.dir ?? SNAPSHOT_DIR;
  const date = options.date ?? localDate();
  const path = join(dir, `${date}.json`);

  if (existsSync(path) && !options.force) {
    const existing = await loadSnapshot(date, dir);
    return {
      date,
      path,
      written: false,
      taskCount: existing.tasks.length,
      assignee: existing.meta.assignee,
    };
  }

  const snapshot = takeSnapshot({ ...options, date });
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);

  return {
    date,
    path,
    written: true,
    taskCount: snapshot.tasks.length,
    assignee: snapshot.meta.assignee,
  };
}

export async function writeReportFile(
  report: StandupReport,
  dir = REPORT_DIR,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${report.to}.md`);
  await writeFile(path, report.markdown);
  return path;
}
