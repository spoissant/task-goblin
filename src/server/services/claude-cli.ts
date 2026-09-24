/**
 * Thin adapter over the `claude` CLI for background sessions. No DB access.
 *
 * Verified against Claude Code 2.1.278: `claude --bg --rc --name X "<prompt>"`
 * prints `backgrounded · <shortId>`; the daemon then writes
 * `~/.claude/jobs/<shortId>/state.json`.
 */
import { homedir } from "os";
import { expandPath } from "../lib/path";
import { runCommand, type CommandResult } from "../lib/process";

export interface JobState {
  state: "working" | "blocked" | "done" | "failed" | "stopped" | string;
  /** Live turn activity, more current than `state`: active | idle | blocked. */
  tempo?: string;
  inFlight?: { tasks?: number; queued?: number; kinds?: string[]; drainableMonitors?: number } | null;
  /** Scheduled wake-up: the agent parked itself and means to come back. */
  wake?: { at?: number | string } | null;
  detail?: string | null;
  needs?: string | null;
  output?: { result?: string | null } | null;
  sessionId?: string;
  bridgeSessionId?: string;
  cwd?: string;
  name?: string;
  updatedAt?: string;
  firstTerminalAt?: string | null;
  /** The session's transcript (.jsonl). */
  linkScanPath?: string;
}

export interface AgentEntry {
  id?: string; // short id, background sessions only
  cwd: string;
  kind: "background" | "interactive" | string;
  startedAt: number;
  sessionId: string;
  name?: string;
  state?: string;
  status?: string;
  pid?: number;
}

const SPAWN_TIMEOUT_MS = 60_000;
const SHORT_ID_RE = /backgrounded\s*[·•]\s*([0-9a-f]{8})/;

export function jobsDir(): string {
  return process.env.CLAUDE_JOBS_DIR ?? `${homedir()}/.claude/jobs`;
}

export function sessionLink(bridgeSessionId: string | null | undefined): string | null {
  if (!bridgeSessionId) return null;
  const id = bridgeSessionId.replace(/^cse_/, "");
  return `https://claude.ai/code/session_${id}`;
}

export type SpawnResult = { shortId: string } | { error: string };

export interface SpawnOptions {
  cwd: string;
  name: string;
  prompt: string;
  /** `--model` alias; omitted falls back to the CLI default. */
  model?: string | null;
  /** `--effort` level; omitted falls back to the CLI default. */
  effort?: string | null;
}

/** Start a background session with Remote Control in `cwd`. */
export async function spawnBackground(opts: SpawnOptions): Promise<SpawnResult> {
  const startedAt = Date.now();
  const args = ["--bg", "--rc", "--name", opts.name];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  args.push(opts.prompt);
  const result = await runCommand("claude", args, {
    cwd: opts.cwd,
    timeoutMs: SPAWN_TIMEOUT_MS,
  });

  const match = `${result.stdout}\n${result.stderr}`.match(SHORT_ID_RE);
  if (match) return { shortId: match[1] };

  // Output changed or was swallowed: find the session the daemon just registered.
  const expandedCwd = expandPath(opts.cwd);
  const candidates = (await listAgents())
    .filter((a) => a.kind === "background" && a.id && a.cwd === expandedCwd && a.startedAt >= startedAt - 5_000)
    .sort((a, b) => b.startedAt - a.startedAt);
  if (candidates[0]?.id) return { shortId: candidates[0].id };

  const tail = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-800);
  return { error: `claude --bg did not return a session id (exit ${result.exitCode})${tail ? `: ${tail}` : ""}` };
}

/** Read a background job's state file; null when missing or unreadable. */
export async function readJobState(shortId: string): Promise<JobState | null> {
  try {
    const file = Bun.file(`${jobsDir()}/${shortId}/state.json`);
    if (!(await file.exists())) return null;
    return (await file.json()) as JobState;
  } catch {
    return null;
  }
}

const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

/**
 * WORKAROUND until the CLI reports it itself: a background session parked on
 * an unanswered AskUserQuestion keeps `tempo: "active"` and no `needs` in
 * state.json (seen on 2.1.281), so it looks like it is still working. Read the
 * transcript tail instead: if the last message is an AskUserQuestion call with
 * no answer yet, return its question. Delete this once state.json flips to
 * blocked for these prompts.
 */
export async function pendingQuestion(transcriptPath: string): Promise<string | null> {
  try {
    const file = Bun.file(transcriptPath);
    if (!(await file.exists())) return null;
    const text = await file.slice(Math.max(0, file.size - TRANSCRIPT_TAIL_BYTES)).text();
    const lines = text.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: { type?: string; message?: { content?: unknown } };
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue; // the partial first line of the tail
      }
      if (entry.type === "user") return null; // answered, or a new prompt
      if (entry.type !== "assistant") continue;
      const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
      const ask = content.find((c) => c?.type === "tool_use" && c.name === "AskUserQuestion");
      if (!ask) return null;
      return ask.input?.questions?.[0]?.question ?? "Answer the session's question";
    }
    return null;
  } catch {
    return null;
  }
}

export async function listAgents(): Promise<AgentEntry[]> {
  const result = await runCommand("claude", ["agents", "--json", "--all"], { cwd: homedir(), timeoutMs: 30_000 });
  if (result.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? (parsed as AgentEntry[]) : [];
  } catch {
    return [];
  }
}

export function stopSession(shortId: string): Promise<CommandResult> {
  return runCommand("claude", ["stop", shortId], { cwd: homedir(), timeoutMs: 30_000 });
}

/** Restart a background session whose process is gone; its conversation is kept. */
export function respawnSession(shortId: string): Promise<CommandResult> {
  return runCommand("claude", ["respawn", shortId], { cwd: homedir(), timeoutMs: 30_000 });
}
