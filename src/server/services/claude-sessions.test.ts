import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { createRouter, type Routes } from "../router";
import { routes } from "../routes";
import { withErrorBoundary } from "../middleware";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import { pollActiveSessions, reapIdleProcesses, setCapacityCheck, syncProcessLiveness } from "./claude-sessions";

const ok = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
const JOBS_DIR = `${import.meta.dir}/../../../.test-jobs`;
const MAIN_PATH = `${import.meta.dir}/../../..`; // any existing directory works as the "main checkout"

describe("claude sessions", () => {
  let router: ReturnType<typeof createRouter>;
  const commands: string[] = [];

  const request = (method: string, path: string, body?: unknown) =>
    withErrorBoundary(() =>
      router.route(
        new Request("http://localhost" + path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }),
      ),
    );

  const writeState = (shortId: string, state: Record<string, unknown>) => {
    mkdirSync(`${JOBS_DIR}/${shortId}`, { recursive: true });
    writeFileSync(`${JOBS_DIR}/${shortId}/state.json`, JSON.stringify(state));
  };

  beforeAll(() => {
    createTestTables(sqlite);
    router = createRouter(routes as Routes);
    process.env.CLAUDE_JOBS_DIR = JOBS_DIR;
  });

  beforeEach(() => {
    commands.length = 0;
    rmSync(JOBS_DIR, { recursive: true, force: true });
    for (const t of ["claude_sessions", "task_worktrees", "todos", "tasks", "worktrees", "repositories"]) {
      sqlite.exec(`DELETE FROM ${t}`);
    }
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1)`);
    sqlite.exec(`INSERT INTO worktrees (id, repository_id, path, created_at, updated_at) VALUES (1, 1, '${MAIN_PATH}', 'x', 'x')`);
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, repository_id, pr_number, head_branch, pr_state, is_draft, approved_review_count)
      VALUES (1, 'A task', 'Code review', ${ts}, ${ts}, 'EV-1', 1, 10, 'fix/EV-1', 'open', 0, 0)`);
    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      if (cmd === "claude" && args[0] === "--bg") return ok("backgrounded · abcd1234\n  claude attach abcd1234");
      if (cmd === "claude" && args[0] === "agents") return ok("[]");
      return ok();
    });
  });

  afterEach(() => {
    resetCommandRunner();
    rmSync(JOBS_DIR, { recursive: true, force: true });
  });

  it("rejects unknown chores", async () => {
    const res = await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNKNOWN_CHORE");
  });

  it("starts task-less PR reviews in the main checkout, in parallel, one per PR", async () => {
    // a full Docker stack cap must not hold back reviews: they never boot a stack
    setCapacityCheck(async () => "queued");
    let spawns = 0;
    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      if (cmd === "claude" && args[0] === "--bg") return ok(`backgrounded · 0000000${++spawns}`);
      return ok("[]");
    });
    try {
      const bad = await request("POST", "/api/v1/review-sessions", { prUrl: "https://example.com/x" });
      expect(bad.status).toBe(400);
      const unknown = await request("POST", "/api/v1/review-sessions", { prUrl: "https://github.com/hb/other/pull/1" });
      expect((await unknown.json()).error.code).toBe("NO_REPOSITORY");

      const res = await request("POST", "/api/v1/review-sessions", { prUrl: "https://github.com/HB/alumni_connect/pull/42" });
      expect(res.status).toBe(202);
      const created = await res.json();
      expect(created.taskId).toBeNull();
      expect(created.prUrl).toBe("https://github.com/HB/alumni_connect/pull/42");
      expect(created.cwd).toBe(MAIN_PATH);
      expect(created.prompt).toBe("/chore-code-review-pr https://github.com/HB/alumni_connect/pull/42");

      const second = await request("POST", "/api/v1/review-sessions", { prUrl: "https://github.com/hb/alumni_connect/pull/43" });
      expect(second.status).toBe(202);
      const dup = await request("POST", "/api/v1/review-sessions", { prUrl: "https://github.com/HB/alumni_connect/pull/42" });
      expect(dup.status).toBe(409);

      await new Promise((r) => setTimeout(r, 50));
      expect(commands.filter((c) => c.startsWith("claude --bg"))).toEqual([
        "claude --bg --rc --name alumni_connect#42 · Code review /chore-code-review-pr https://github.com/HB/alumni_connect/pull/42",
        "claude --bg --rc --name alumni_connect#43 · Code review /chore-code-review-pr https://github.com/hb/alumni_connect/pull/43",
      ]);

      const list = await (await request("GET", "/api/v1/review-sessions")).json();
      expect(list.items.map((s: { state: string }) => s.state)).toEqual(["working", "working"]);
      // task views ignore them
      expect((await (await request("GET", "/api/v1/sessions")).json()).items).toHaveLength(0);
      const recent = await (await request("GET", "/api/v1/sessions/recent")).json();
      expect(recent.items).toHaveLength(2);
      expect(recent.items[0].taskTitle).toBeNull();
    } finally {
      setCapacityCheck(async () => "ok");
    }
  });

  it("starts a main-checkout chore, polls it to done, and reaps it", async () => {
    const res = await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    expect(res.status).toBe(202);
    const created = await res.json();
    expect(created.state).toBe("preparing");
    expect(created.cwd).toBe(MAIN_PATH);
    expect(created.prompt).toBe("/chore-request-reviews 1");

    // let the background start run
    await new Promise((r) => setTimeout(r, 50));
    const spawn = commands.find((c) => c.startsWith("claude --bg"));
    expect(spawn).toBe("claude --bg --rc --name EV-1 · Request Code Reviews /chore-request-reviews 1");

    let list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("working");
    expect(list.items[0].shortId).toBe("abcd1234");

    // a second start is refused while active
    const dup = await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    expect(dup.status).toBe(409);

    writeState("abcd1234", {
      state: "working",
      detail: "Posting to Slack",
      bridgeSessionId: "cse_01ABC",
      sessionId: "11111111-2222-3333-4444-555555555555",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/sessions")).json();
    expect(list.items[0].detail).toBe("Posting to Slack");
    expect(list.items[0].link).toBe("https://claude.ai/code/session_01ABC");

    writeState("abcd1234", {
      state: "done",
      detail: "posted",
      output: { result: "Review requested" },
      bridgeSessionId: "cse_01ABC",
      updatedAt: "2026-01-01T00:02:00.000Z",
      firstTerminalAt: "2026-01-01T00:02:00.000Z",
    });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("done");
    expect(list.items[0].result).toBe("Review requested");

    // finished long ago → process gets stopped once
    await reapIdleProcesses();
    expect(commands.filter((c) => c === "claude stop abcd1234")).toHaveLength(1);
    await reapIdleProcesses();
    expect(commands.filter((c) => c === "claude stop abcd1234")).toHaveLength(1);
  });

  it("detects a dead process, respawns it, and spares recently active sessions from the reaper", async () => {
    await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    await new Promise((r) => setTimeout(r, 50));
    const id = (await (await request("GET", "/api/v1/tasks/1/sessions")).json()).items[0].id;
    const recent = new Date().toISOString();
    writeState("abcd1234", { state: "done", tempo: "idle", updatedAt: recent, firstTerminalAt: "2026-01-01T00:00:00.000Z" });
    await pollActiveSessions();

    // finished long ago but touched just now (chat or respawn): not reaped
    await reapIdleProcesses();
    expect(commands.filter((c) => c === "claude stop abcd1234")).toHaveLength(0);

    let pid: number | null = null;
    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      if (args[0] === "agents") return ok(JSON.stringify([{ id: "abcd1234", kind: "background", cwd: "/", startedAt: 0, sessionId: "s", pid }]));
      if (args[0] === "respawn") pid = 42;
      return ok();
    });

    await syncProcessLiveness();
    let row = await (await request("GET", `/api/v1/sessions/${id}`)).json();
    expect(row.processStoppedAt).not.toBeNull();

    const res = await request("POST", `/api/v1/sessions/${id}/respawn`);
    expect(res.status).toBe(200);
    expect((await res.json()).processStoppedAt).toBeNull();
    expect(commands).toContain("claude respawn abcd1234");

    await syncProcessLiveness();
    row = await (await request("GET", `/api/v1/sessions/${id}`)).json();
    expect(row.processStoppedAt).toBeNull();
  });

  it("stops a working session", async () => {
    await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    await new Promise((r) => setTimeout(r, 50));
    const list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    const res = await request("POST", `/api/v1/sessions/${list.items[0].id}/stop`);
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("stopped");
    expect(commands).toContain("claude stop abcd1234");
  });

  it("tells a finished turn apart from an agent parked waiting", async () => {
    await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    await new Promise((r) => setTimeout(r, 50));
    const idle = { state: "working", tempo: "idle", updatedAt: "2026-01-01T00:01:00.000Z" };

    // tempo blocked wins over a stale `working`, with no delay
    writeState("abcd1234", { ...idle, tempo: "blocked", needs: "Which branch?" });
    await pollActiveSessions();
    let list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("blocked");

    // answered: `state` stays blocked in state.json, but an active tempo means working
    writeState("abcd1234", {
      state: "blocked",
      tempo: "active",
      detail: "go ahead and push",
      inFlight: { tasks: 1, queued: 0, kinds: ["local_bash"], drainableMonitors: 0 },
      updatedAt: "2026-01-01T00:02:00.000Z",
    });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("working");

    // parked on a scheduled wake-up: still working, however long it idles
    writeState("abcd1234", { ...idle, wake: { at: Date.now() + 600_000 }, inFlight: { tasks: 0, queued: 0, kinds: [] } });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("working");

    // parked on a monitor it can drain itself: still working
    writeState("abcd1234", { ...idle, inFlight: { tasks: 0, queued: 0, kinds: ["session_cron"] } });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("working");

    // nothing pending: the run is over on the next poll
    writeState("abcd1234", {
      ...idle,
      detail: "pushed the merge",
      inFlight: { tasks: 0, queued: 0, kinds: [], drainableMonitors: 0 },
    });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("done");
    expect(list.items[0].firstTerminalAt).toBeTruthy();
  });

  it("treats an unanswered AskUserQuestion as blocked despite an active tempo", async () => {
    await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    await new Promise((r) => setTimeout(r, 50));
    const transcript = `${JOBS_DIR}/transcript.jsonl`;
    const ask = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "AskUserQuestion", input: { questions: [{ question: "Send it?" }] } }],
      },
    };
    const writeTranscript = (...entries: unknown[]) =>
      writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    writeState("abcd1234", { state: "working", tempo: "active", linkScanPath: transcript });

    writeTranscript(ask, { type: "attachment" });
    await pollActiveSessions();
    let list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("blocked");
    expect(list.items[0].needs).toBe("Send it?");

    // answered: back to working
    writeTranscript(ask, { type: "user", message: { content: [{ type: "tool_result" }] } });
    await pollActiveSessions();
    list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("working");
  });

  it("marks a session failed when state.json never appears and the daemon does not know it", async () => {
    await request("POST", "/api/v1/tasks/1/sessions", { choreKey: "request-reviews" });
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 6; i++) await pollActiveSessions();
    const list = await (await request("GET", "/api/v1/tasks/1/sessions")).json();
    expect(list.items[0].state).toBe("failed");
  });
});
