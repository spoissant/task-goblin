#!/usr/bin/env bun
import {
  REPORT_DIR,
  SNAPSHOT_DIR,
  StandupRangeError,
  buildReport,
  writeReportFile,
  writeSnapshot,
} from "./service";

const API_URL = process.env.API_URL ?? "http://localhost:3456";
const SYNC_TIMEOUT_MS = 120_000;

interface Args {
  command: string;
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const [command = "report", ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith("--")) continue;
    const [name, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags[name!] = inline;
    } else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) {
      flags[name!] = rest[++i]!;
    } else {
      flags[name!] = true;
    }
  }
  return { command, flags };
}

const str = (v: string | true | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Best-effort sync. The DB only reflects reality as of the last sync, so a
 *  snapshot taken while the API server is down records that in its metadata
 *  rather than silently reporting stale state as fact. */
async function triggerSync(): Promise<{ ok: boolean; error: string | null }> {
  for (const path of ["/api/v1/sync/jira", "/api/v1/sync/github"]) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, error: `${path} returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `${path}: ${msg} (is \`bun run dev:api\` running?)` };
    }
  }
  return { ok: true, error: null };
}

async function cmdSnapshot(flags: Args["flags"]): Promise<number> {
  let syncTriggered = false;
  let syncError: string | null = null;
  if (!flags["no-sync"]) {
    const result = await triggerSync();
    syncTriggered = result.ok;
    syncError = result.error;
    if (!result.ok) console.warn(`Sync skipped: ${result.error}`);
  }

  const result = await writeSnapshot({
    dir: str(flags.dir),
    date: str(flags.date),
    force: flags.force === true,
    dbPath: str(flags.db),
    me: str(flags.me),
    syncTriggered,
    syncError,
  });

  console.log(
    result.written
      ? `Wrote ${result.path} — ${result.taskCount} tasks scoped to "${result.assignee}".`
      : `Snapshot ${result.path} already exists — use --force to overwrite.`,
  );
  return 0;
}

async function cmdReport(flags: Args["flags"]): Promise<number> {
  try {
    const report = await buildReport({
      from: str(flags.from),
      to: str(flags.to),
      dir: str(flags.dir),
    });

    if (!flags["no-write"]) {
      const path = await writeReportFile(report, str(flags["report-dir"]) ?? REPORT_DIR);
      console.error(`Wrote ${path}`);
    }
    console.log(report.markdown);
    return 0;
  } catch (err) {
    if (err instanceof StandupRangeError) {
      console.error(err.message);
      console.error(
        err.available.length
          ? `Available snapshots: ${err.available.join(", ")}`
          : `No snapshots in ${SNAPSHOT_DIR}/ yet — run \`bun run standup:snapshot\`.`,
      );
      return 1;
    }
    throw err;
  }
}

const USAGE = `task-goblin standup

  bun run standup:snapshot [--force] [--no-sync] [--date YYYY-MM-DD] [--db PATH] [--me "Name"]
      Sync (if the API is up), then write ${SNAPSHOT_DIR}/<date>.json.

  bun run standup [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--no-write]
      Diff two snapshots and write ${REPORT_DIR}/<to>.md. Defaults to the two
      most recent snapshots. Also available in the app at /standup.
`;

const { command, flags } = parseArgs(Bun.argv.slice(2));

let exitCode = 0;
switch (command) {
  case "snapshot":
    exitCode = await cmdSnapshot(flags);
    break;
  case "report":
    exitCode = await cmdReport(flags);
    break;
  default:
    console.error(USAGE);
    exitCode = 1;
}
process.exit(exitCode);
