/**
 * Usage of each AI session, read from its Claude Code transcript: one row per
 * API request (subagents included) plus per-session totals on the session row.
 *
 * Claude Code deletes old transcripts (`cleanupPeriodDays`, 30 by default), so
 * each one is copied to an archive before it is parsed. The archive mirrors
 * Claude's layout: `<sessionId>.jsonl` and `<sessionId>/subagents/agent-<id>.jsonl`.
 * To recompute a session (e.g. after adding a price), clear its `usage_collected_at`.
 */
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessionRequests, claudeSessions, repositories, tasks } from "../../db/schema";
import { now } from "../lib/timestamp";
import type { ConcurrencyDay, SessionAnalyticsRow } from "../../shared/types";

export function projectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? `${homedir()}/.claude/projects`;
}

export function archiveDir(): string {
  return process.env.TRANSCRIPTS_DIR ?? "transcripts";
}

/** API list prices in $ per million tokens. */
interface Price {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  /** Rate card once the prompt (input + cache tokens) exceeds 100K tokens; same card when absent. */
  over100k?: Price;
}

const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    over100k: { input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 },
  },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
};
const LONG_PROMPT_TOKENS = 100_000;
const FAST_MULTIPLIER = 2; // fast mode bills 2x the standard rates

type RequestRow = Omit<typeof claudeSessionRequests.$inferInsert, "id" | "sessionId">;

export function requestCost(r: RequestRow): number | null {
  const card = PRICES[r.model.replace(/-\d{8}$/, "")]; // drop date suffixes like -20251001
  if (!card) return null;
  const promptTokens = r.inputTokens + r.cacheWrite5mTokens + r.cacheWrite1hTokens + r.cacheReadTokens;
  const price = card.over100k && promptTokens > LONG_PROMPT_TOKENS ? card.over100k : card;
  const dollars =
    r.inputTokens * price.input +
    r.outputTokens * price.output +
    r.cacheWrite5mTokens * price.cacheWrite5m +
    r.cacheWrite1hTokens * price.cacheWrite1h +
    r.cacheReadTokens * price.cacheRead;
  return (dollars / 1_000_000) * (r.speed === "fast" ? FAST_MULTIPLIER : 1);
}

export interface TranscriptUsage {
  requests: RequestRow[];
  activeMs: number;
  turnCount: number;
  subagentCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readLines(path: string): any[] {
  const lines = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // a line being written while we read
    }
  }
  return lines;
}

function subagentFiles(dir: string, sessionId: string): string[] {
  const subDir = `${dir}/${sessionId}/subagents`;
  if (!existsSync(subDir)) return [];
  return readdirSync(subDir)
    .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
    .map((f) => `${subDir}/${f}`);
}

/** Parse a session's transcript and its subagents' from `dir`. */
export function parseTranscript(dir: string, sessionId: string): TranscriptUsage {
  const files = [{ path: `${dir}/${sessionId}.jsonl`, agentId: null as string | null, agentType: null as string | null }];
  for (const path of subagentFiles(dir, sessionId)) {
    const meta = path.replace(/\.jsonl$/, ".meta.json");
    let agentType: string | null = null;
    try {
      agentType = JSON.parse(readFileSync(meta, "utf8")).agentType ?? null;
    } catch {
      // no meta file
    }
    files.push({ path, agentId: path.slice(path.lastIndexOf("/agent-") + 7, -6), agentType });
  }

  const requests = new Map<string, RequestRow>(); // one transcript line per content block: keep one per message
  let activeMs = 0;
  let turnCount = 0;
  for (const file of files) {
    for (const line of readLines(file.path)) {
      if (file.agentId === null && line.type === "system" && line.subtype === "turn_duration") {
        activeMs += line.durationMs ?? 0;
        turnCount++;
        continue;
      }
      const message = line.type === "assistant" ? line.message : null;
      const usage = message?.usage;
      if (!usage || !message.model || message.model.startsWith("<")) continue; // <synthetic> error stubs
      const messageId = message.id ?? line.requestId ?? line.uuid;
      if (requests.has(messageId)) continue;
      const ttlSplit = usage.cache_creation; // absent on old transcripts: count all writes as 5m
      const row: RequestRow = {
        messageId,
        agentId: file.agentId,
        agentType: file.agentType,
        timestamp: line.timestamp,
        model: message.model,
        effort: line.effort ?? null,
        speed: usage.speed ?? null,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
        cacheWrite5mTokens: ttlSplit ? (ttlSplit.ephemeral_5m_input_tokens ?? 0) : (usage.cache_creation_input_tokens ?? 0),
        cacheWrite1hTokens: ttlSplit?.ephemeral_1h_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
      };
      row.costUsd = requestCost(row);
      requests.set(messageId, row);
    }
  }
  return { requests: [...requests.values()], activeMs, turnCount, subagentCount: files.length - 1 };
}

/** Newest mtime across a session's transcript files, in ms. */
function lastModified(dir: string, sessionId: string): number {
  const paths = [`${dir}/${sessionId}.jsonl`, ...subagentFiles(dir, sessionId)];
  return Math.max(...paths.map((p) => statSync(p).mtimeMs));
}

function archive(sourceDir: string, sessionId: string): void {
  const dest = archiveDir();
  cpSync(`${sourceDir}/${sessionId}.jsonl`, `${dest}/${sessionId}.jsonl`);
  if (existsSync(`${sourceDir}/${sessionId}`)) {
    cpSync(`${sourceDir}/${sessionId}`, `${dest}/${sessionId}`, { recursive: true });
  }
}

function findSourceDir(projectDirs: string[], sessionId: string): string | null {
  return projectDirs.find((d) => existsSync(`${d}/${sessionId}.jsonl`)) ?? null;
}

const INSERT_CHUNK = 500;

/**
 * Archive and (re)parse every session whose transcript changed since it was
 * last collected. Cheap when nothing changed: a few stat calls per session.
 */
export async function collectSessionUsage(): Promise<void> {
  const rows = await db
    .select({ id: claudeSessions.id, sessionId: claudeSessions.sessionId, collectedAt: claudeSessions.usageCollectedAt })
    .from(claudeSessions)
    .where(isNotNull(claudeSessions.sessionId));
  if (rows.length === 0) return;

  const root = projectsDir();
  const projectDirs = existsSync(root) ? readdirSync(root).map((d) => `${root}/${d}`) : [];

  for (const row of rows) {
    const sessionId = row.sessionId!;
    try {
      const startedAt = now(); // before reading, so writes during the parse trigger a re-collect
      const source = findSourceDir(projectDirs, sessionId);
      if (source) {
        if (row.collectedAt && lastModified(source, sessionId) <= Date.parse(row.collectedAt)) continue;
        archive(source, sessionId);
      } else if (row.collectedAt || !existsSync(`${archiveDir()}/${sessionId}.jsonl`)) {
        continue; // transcript gone: keep what was collected
      }

      const usage = parseTranscript(archiveDir(), sessionId);
      const costs = usage.requests.map((r) => r.costUsd);
      const costUsd = costs.includes(null) ? null : (costs as number[]).reduce((a, b) => a + b, 0);

      await db.transaction(async (tx) => {
        await tx.delete(claudeSessionRequests).where(eq(claudeSessionRequests.sessionId, row.id));
        for (let i = 0; i < usage.requests.length; i += INSERT_CHUNK) {
          const chunk = usage.requests.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, sessionId: row.id }));
          await tx.insert(claudeSessionRequests).values(chunk);
        }
        await tx
          .update(claudeSessions)
          .set({
            costUsd,
            activeMs: usage.activeMs,
            turnCount: usage.turnCount,
            subagentCount: usage.subagentCount,
            usageCollectedAt: startedAt,
          })
          .where(eq(claudeSessions.id, row.id));
      });
    } catch (err) {
      console.error(`[usage] collecting session ${row.id} failed`, err);
    }
  }
}

/** The value with the highest count. */
function mostFrequent(counts: Map<string | null, number> | undefined): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts ?? []) {
    if (count > bestCount) [best, bestCount] = [value, count];
  }
  return best;
}

/**
 * One row per collected session, for the analytics page. Model and effort are
 * the ones most of the main agent's requests ran on, not the requested alias.
 */
export async function listSessionAnalytics(): Promise<SessionAnalyticsRow[]> {
  const rows = await db
    .select({ session: claudeSessions, jiraKey: tasks.jiraKey, taskTitle: tasks.title, repoAlias: repositories.alias, repo: repositories.repo })
    .from(claudeSessions)
    .leftJoin(tasks, eq(tasks.id, claudeSessions.taskId))
    .leftJoin(repositories, eq(repositories.id, claudeSessions.repositoryId))
    .where(isNotNull(claudeSessions.usageCollectedAt));

  const mainRequests = await db
    .select({
      sessionId: claudeSessionRequests.sessionId,
      model: claudeSessionRequests.model,
      effort: claudeSessionRequests.effort,
      count: sql<number>`count(*)`,
    })
    .from(claudeSessionRequests)
    .where(isNull(claudeSessionRequests.agentId))
    .groupBy(claudeSessionRequests.sessionId, claudeSessionRequests.model, claudeSessionRequests.effort);

  const models = new Map<number, Map<string | null, number>>();
  const efforts = new Map<number, Map<string | null, number>>();
  for (const r of mainRequests) {
    for (const [byKey, key] of [[models, r.model], [efforts, r.effort]] as const) {
      const counts = byKey.get(r.sessionId) ?? new Map<string | null, number>();
      counts.set(key, (counts.get(key) ?? 0) + r.count);
      byKey.set(r.sessionId, counts);
    }
  }

  return rows.map(({ session: s, jiraKey, taskTitle, repoAlias, repo }) => ({
    id: s.id,
    taskId: s.taskId,
    task: jiraKey ?? s.name.split(" · ")[0], // the name keeps the key if the task is gone
    taskTitle,
    chore: s.choreName,
    repo: repoAlias ?? repo,
    model: mostFrequent(models.get(s.id))?.replace(/^claude-/, "").replace(/-\d{8}$/, "") ?? null,
    effort: mostFrequent(efforts.get(s.id)),
    createdAt: s.createdAt,
    costUsd: s.costUsd,
    activeMs: s.activeMs,
    turnCount: s.turnCount,
    subagentCount: s.subagentCount,
  }));
}

const SLOT_SECONDS = 300;

/** Per day, the 5-minute slots with a request and the sessions and agents active in them. */
export function listDailyConcurrency(): ConcurrencyDay[] {
  return db.all<ConcurrencyDay>(sql`
    with active as (
      select substr(timestamp, 1, 10) as day,
             cast(strftime('%s', timestamp) as integer) / ${SLOT_SECONDS} as slot,
             session_id,
             coalesce(agent_id, '') as agent
      from claude_session_requests
      group by 1, 2, 3, 4
    )
    select day,
           count(distinct slot) as slots,
           count(distinct slot || ':' || session_id) as sessionSlots,
           count(*) as agentSlots
    from active
    group by day
    order by day
  `);
}
