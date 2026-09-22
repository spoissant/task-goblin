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
  inFlight?: { tasks?: number } | null;
  detail?: string | null;
  needs?: string | null;
  output?: { result?: string | null } | null;
  sessionId?: string;
  bridgeSessionId?: string;
  cwd?: string;
  name?: string;
  updatedAt?: string;
  firstTerminalAt?: string | null;
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

/** Start a background session with Remote Control in `cwd`. */
export async function spawnBackground(opts: { cwd: string; name: string; prompt: string }): Promise<SpawnResult> {
  const startedAt = Date.now();
  const result = await runCommand("claude", ["--bg", "--rc", "--name", opts.name, opts.prompt], {
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
