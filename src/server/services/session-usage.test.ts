import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync, appendFileSync } from "fs";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { collectSessionUsage, requestCost } from "./session-usage";

const ROOT = `${import.meta.dir}/../../../.test-usage`;
const PROJECTS = `${ROOT}/projects`;
const ARCHIVE = `${ROOT}/archive`;
const SID = "11111111-2222-3333-4444-555555555555";
const DIR = `${PROJECTS}/-Users-me-repo`;

const assistant = (id: string, model: string, usage: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: "2026-10-01T10:00:00.000Z", effort: "high", message: { id, model, usage }, ...extra });

const usage = (input: number, output: number, write1h: number, read: number) => ({
  input_tokens: input,
  output_tokens: output,
  output_tokens_details: { thinking_tokens: 10 },
  cache_creation_input_tokens: write1h,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write1h },
  cache_read_input_tokens: read,
  server_tool_use: { web_search_requests: 0 },
  speed: "standard",
});

const writeTranscript = () => {
  mkdirSync(`${DIR}/${SID}/subagents`, { recursive: true });
  writeFileSync(
    `${DIR}/${SID}.jsonl`,
    [
      JSON.stringify({ type: "user", message: { content: "go" } }),
      // one line per content block, same message id: counted once
      assistant("msg_1", "claude-opus-5-5", usage(1_000_000, 100_000, 1_000_000, 0)),
      assistant("msg_1", "claude-opus-5-5", usage(1_000_000, 100_000, 1_000_000, 0)),
      assistant("msg_err", "<synthetic>", usage(0, 0, 0, 0)),
      JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 60_000 }),
      JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 30_000 }),
      "{ partial line",
    ].join("\n"),
  );
  writeFileSync(
    `${DIR}/${SID}/subagents/agent-abc.jsonl`,
    assistant("msg_2", "claude-haiku-4-5-20251001", usage(0, 0, 0, 1_000_000), { effort: null }),
  );
  writeFileSync(`${DIR}/${SID}/subagents/agent-abc.meta.json`, JSON.stringify({ agentType: "Explore" }));
};

const session = () => sqlite.query("SELECT * FROM claude_sessions WHERE id = 1").get() as Record<string, unknown>;
const requests = () =>
  sqlite.query("SELECT * FROM claude_session_requests ORDER BY message_id").all() as Record<string, unknown>[];

describe("requestCost", () => {
  const row = (model: string, input: number, read: number, output: number) => ({
    messageId: "m",
    timestamp: "2026-10-01T10:00:00.000Z",
    model,
    effort: null,
    speed: "standard",
    inputTokens: input,
    outputTokens: output,
    thinkingTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: read,
    webSearchRequests: 0,
  });

  it("bills Haiku 5.5 on the long-prompt card once input plus cache tokens exceed 100K", () => {
    // 50K input + 50K cache reads = 100K: short card ($0.10 in, $0.01 reads, $0.50 out)
    expect(requestCost(row("claude-haiku-5-5", 50_000, 50_000, 1_000))).toBeCloseTo(0.005 + 0.0005 + 0.0005, 6);
    // one more token: long card ($0.50 in, $0.05 reads, $2.50 out)
    expect(requestCost(row("claude-haiku-5-5", 50_001, 50_000, 1_000))).toBeCloseTo(0.0250005 + 0.0025 + 0.0025, 6);
  });

  it("returns null for unknown models", () => {
    expect(requestCost(row("<synthetic>", 1, 0, 0))).toBeNull();
  });
});

describe("session usage", () => {
  beforeAll(() => {
    createTestTables(sqlite);
    process.env.CLAUDE_PROJECTS_DIR = PROJECTS;
    process.env.TRANSCRIPTS_DIR = ARCHIVE;
  });

  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ARCHIVE, { recursive: true });
    sqlite.exec("DELETE FROM claude_session_requests");
    sqlite.exec("DELETE FROM claude_sessions");
    sqlite.exec(`INSERT INTO claude_sessions (id, chore_key, chore_name, prompt, cwd, name, state, session_id, created_at, updated_at)
      VALUES (1, 'start-task', 'Start Task', 'p', '/Users/me/repo', 'EV-1 · Start Task', 'done', '${SID}', 'x', 'x')`);
    writeTranscript();
  });

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("records each request once, with subagents, cost and active time", async () => {
    await collectSessionUsage();

    const rows = requests();
    expect(rows.map((r) => [r.message_id, r.agent_id, r.agent_type, r.model, r.effort])).toEqual([
      ["msg_1", null, null, "claude-opus-5-5", "high"],
      ["msg_2", "abc", "Explore", "claude-haiku-4-5-20251001", null],
    ]);
    // opus: 1M input $4 + 0.1M output $2 + 1M 1h writes $8; haiku: 1M cache reads $0.10
    expect(rows[0].cost_usd).toBeCloseTo(14);
    expect(rows[1].cost_usd).toBeCloseTo(0.1);

    const s = session();
    expect(s.cost_usd).toBeCloseTo(14.1);
    expect(s.active_ms).toBe(90_000);
    expect(s.turn_count).toBe(2);
    expect(s.subagent_count).toBe(1);
    expect(s.usage_collected_at).not.toBeNull();
    expect(existsSync(`${ARCHIVE}/${SID}.jsonl`)).toBe(true);
    expect(existsSync(`${ARCHIVE}/${SID}/subagents/agent-abc.jsonl`)).toBe(true);
  });

  it("re-collects only when the transcript changed, and keeps the data once it is deleted", async () => {
    await collectSessionUsage();
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${DIR}/${SID}.jsonl`, old, old);
    utimesSync(`${DIR}/${SID}/subagents/agent-abc.jsonl`, old, old);

    appendFileSync(`${DIR}/${SID}.jsonl`, "\n" + assistant("msg_3", "claude-opus-5-5", usage(0, 0, 0, 0)));
    utimesSync(`${DIR}/${SID}.jsonl`, old, old); // unchanged as far as mtime goes: skipped
    await collectSessionUsage();
    expect(requests()).toHaveLength(2);

    const later = new Date(Date.now() + 60_000);
    utimesSync(`${DIR}/${SID}.jsonl`, later, later);
    await collectSessionUsage();
    expect(requests()).toHaveLength(3);

    rmSync(PROJECTS, { recursive: true, force: true }); // Claude Code's cleanup
    await collectSessionUsage();
    expect(requests()).toHaveLength(3);
    expect(session().turn_count).toBe(2);
  });

  it("leaves the session cost empty when a model has no price", async () => {
    appendFileSync(`${DIR}/${SID}.jsonl`, "\n" + assistant("msg_4", "claude-unknown-9", usage(1, 1, 0, 0)));
    await collectSessionUsage();
    expect(requests().find((r) => r.message_id === "msg_4")?.cost_usd).toBeNull();
    expect(session().cost_usd).toBeNull();
  });
});
