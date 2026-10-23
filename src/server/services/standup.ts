/**
 * Standup summaries for the Standup page: runs the `standup` skill headless
 * (`claude -p /standup`) in this repo and keeps its final message. No session
 * row: nobody chats with it, and the CLI reports cost and duration itself.
 * A finished one can be drafted (never sent) in the squad's async-update thread.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { standups } from "../../db/schema";
import { AppError, NotFoundError } from "../lib/errors";
import type { CommandResult } from "../lib/process";
import { getSetting } from "../lib/settings";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { runPrint } from "./claude-cli";
import type { Standup, StandupState } from "../../shared/types";

type StandupRow = typeof standups.$inferSelect;

const REPO_DIR = `${import.meta.dir}/../../..`;
const TIMEOUT_MS = 10 * 60_000;
const HISTORY = 30;
// #squad-connect-and-learn: a Slackbot reminder opens the async-update thread every workday.
const SLACK_CHANNEL_ID = "C0AF2UBCYBE";
const DRAFT_TIMEOUT_MS = 3 * 60_000;
const DRAFT_TOOLS = ["ToolSearch", "mcp__claude_ai_Slack__slack_read_channel", "mcp__claude_ai_Slack__slack_send_message_draft"];
const KEY_LINK = /\]\(([A-Z][A-Z0-9]+-\d+)\)/g;

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
  const update = parseOutput(res);
  if (update.markdown) update.markdown = resolveJiraLinks(update.markdown, await getSetting("jira_host"));
  await db.update(standups).set({ ...update, updatedAt: now() }).where(eq(standups.id, id));
  broadcast("standup");
}

/** The skill links tickets to their bare key: point those links at Jira. */
export function resolveJiraLinks(markdown: string, jiraHost: string | null): string {
  if (!jiraHost) return markdown;
  const host = jiraHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return markdown.replace(KEY_LINK, (_, key: string) => `](https://${host}/browse/${key})`);
}

/** Draft a finished standup as a reply in today's async-update thread; resolves with the Slack link. */
export async function draftToSlack(id: number): Promise<{ link: string }> {
  const [row] = await db.select().from(standups).where(eq(standups.id, id));
  if (!row) throw new NotFoundError("Standup", id);
  if (row.state !== "done" || !row.markdown) throw new AppError("Only a finished standup can be drafted", 409, "STANDUP_NOT_DONE");

  const prompt = draftPrompt(row.markdown, new Date());
  const res = await runPrint({ cwd: REPO_DIR, prompt, model: "sonnet", timeoutMs: DRAFT_TIMEOUT_MS, allowedTools: DRAFT_TOOLS });
  const out = parsePrint(res.stdout);
  const result = out?.result?.trim() ?? "";
  if (res.exitCode === 0 && !out?.is_error && result.startsWith("https://")) return { link: result };
  const reason = (result.replace(/^ERROR:\s*/, "") || res.stderr || "no output").slice(-500);
  throw new AppError(`Slack draft failed: ${reason}`, 502, "SLACK_DRAFT_FAILED");
}

function draftPrompt(markdown: string, at: Date): string {
  const midnight = new Date(at);
  midnight.setHours(0, 0, 0, 0);
  return [
    `Find today's async-update thread in Slack channel ${SLACK_CHANNEL_ID}: the Slackbot reminder asking for async updates in the thread. ` +
      `Read the channel with slack_read_channel, oldest ${Math.floor(midnight.getTime() / 1000)}.`,
    "Create a draft reply in that thread with slack_send_message_draft, thread_ts set to the reminder's ts, and as message the text " +
      "between the markers, exactly as written. Never send a message.",
    "Reply with only the channel_link the tool returns. If there is no reminder today or the draft fails, reply `ERROR: <reason>`.",
    `<<<MESSAGE\n${markdown}\nMESSAGE>>>`,
  ].join("\n\n");
}

interface PrintResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
}

function parsePrint(stdout: string): PrintResult | null {
  try {
    return JSON.parse(stdout) as PrintResult;
  } catch {
    return null; // not JSON: the CLI failed before the session started
  }
}

function parseOutput(res: CommandResult): Partial<StandupRow> {
  const out = parsePrint(res.stdout);
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
