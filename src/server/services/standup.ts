/**
 * Standup summaries for the Standup page: runs the `standup` skill headless
 * (`claude -p /standup`) in this repo and keeps its final message. No session
 * row: nobody chats with it, and the CLI reports cost and duration itself.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { standups } from "../../db/schema";
import { AppError } from "../lib/errors";
import type { CommandResult } from "../lib/process";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { runPrint } from "./claude-cli";
import type { Standup, StandupState } from "../../shared/types";

type StandupRow = typeof standups.$inferSelect;

const REPO_DIR = `${import.meta.dir}/../../..`;
const TIMEOUT_MS = 10 * 60_000;
const HISTORY = 30;

export function toApi(row: StandupRow): Standup {
  return { ...row, state: row.state as StandupState };
}

export async function listStandups(): Promise<StandupRow[]> {
  return db.select().from(standups).orderBy(desc(standups.id)).limit(HISTORY);
}

/** Record a run and generate it in the background; one at a time. */
export async function startStandup(): Promise<StandupRow> {
  const running = await db.select().from(standups).where(eq(standups.state, "running")).limit(1);
  if (running[0]) throw new AppError("A standup is already being generated", 409, "STANDUP_RUNNING");
  const timestamp = now();
  const [row] = await db.insert(standups).values({ state: "running", createdAt: timestamp, updatedAt: timestamp }).returning();
  broadcast("standup");
  void generate(row.id);
  return row;
}

async function generate(id: number): Promise<void> {
  const res = await runPrint({ cwd: REPO_DIR, prompt: "/standup", model: "sonnet", timeoutMs: TIMEOUT_MS });
  await db.update(standups).set({ ...parseOutput(res), updatedAt: now() }).where(eq(standups.id, id));
  broadcast("standup");
}

interface PrintResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
}

function parseOutput(res: CommandResult): Partial<StandupRow> {
  let out: PrintResult | null = null;
  try {
    out = JSON.parse(res.stdout) as PrintResult;
  } catch {
    // not JSON: the CLI failed before the session started
  }
  const usage = { costUsd: out?.total_cost_usd ?? null, durationMs: out?.duration_ms ?? null };
  if (res.exitCode === 0 && out?.result && !out.is_error) return { state: "done", markdown: out.result.trim(), ...usage };
  const reason = (out?.result || res.stderr || res.stdout || "no output").slice(-800);
  return { state: "failed", error: `claude -p exited ${res.exitCode}: ${reason}`, ...usage };
}

/** A run cut off by a server restart never finishes on its own. */
export async function reconcileStandups(): Promise<void> {
  await db
    .update(standups)
    .set({ state: "failed", error: "Interrupted by a server restart", updatedAt: now() })
    .where(eq(standups.state, "running"));
}
