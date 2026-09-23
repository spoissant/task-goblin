import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { appendFileSync } from "fs";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import {
  bootDevStack,
  devStackSettled,
  getDevStackStatus,
  setDevStackRuntime,
  stopDevStack,
} from "./dev-stack";

const ok = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
// resolveMainPath requires an existing directory.
const MAIN = process.cwd();

describe("dev stack", () => {
  const commands: string[] = [];
  let dirty = false;
  let localBranch = true;
  let alive = false;
  let spawned = 0;
  let compiled = false;
  let probeStatus: number | null = null;
  let running = 1; // containers of the main stack still running
  const killTreeCalls: number[] = [];
  const LOG = process.env.DEV_STACK_LOG!;
  const COMPILED_LINE = "\n  \u001b[32m✓\u001b[39m Compiled successfully 14.97s\n";

  beforeAll(() => createTestTables(sqlite));

  beforeEach(() => {
    commands.length = 0;
    dirty = false;
    localBranch = true;
    alive = false;
    spawned = 0;
    compiled = false;
    probeStatus = null;
    running = 1;
    killTreeCalls.length = 0;
    for (const t of ["settings", "tasks", "worktrees", "repositories"]) sqlite.exec(`DELETE FROM ${t}`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled, default_base_branch) VALUES (1, 'hb', 'alumni_connect', 1, 'sprint')`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (2, 'hb', 'front-monorepo', 1)`);
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO worktrees (repository_id, path, created_at, updated_at) VALUES (1, '${MAIN}', ${ts}, ${ts})`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (1, 't1', 'In Progress', ${ts}, ${ts}, 1, 'fix/EV-1')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (2, 't2', 'In Progress', ${ts}, ${ts}, 1, 'fix/EV-2')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (3, 't3', 'In Progress', ${ts}, ${ts}, 2, 'feat/x')`);

    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      if (cmd === "git" && args[0] === "status") return ok(dirty ? " M app.rb" : "");
      if (cmd === "docker" && args[0] === "ps") return ok(Array.from({ length: running }, (_, i) => `c${i}`).join("\n"));
      if (cmd === "/bin/zsh" && args[1]?.includes("stop-dev-server")) alive = false; // the stop command ends the bundler
      if (cmd === "git" && args[0] === "rev-parse" && args.includes("refs/heads/fix/EV-1")) {
        return localBranch ? ok("abc") : { stdout: "", stderr: "", exitCode: 1 };
      }
      return ok();
    });
    setDevStackRuntime({
      spawn() {
        spawned++;
        alive = true;
        // Boot truncates the log first, so the bundler line goes in here when the test wants it.
        if (compiled) appendFileSync(LOG, COMPILED_LINE);
        return { pid: 4000 + spawned, exited: new Promise<number>(() => {}) };
      },
      isAlive: () => alive,
      async killTree(pid) {
        killTreeCalls.push(pid);
        alive = false;
      },
      probe: async () => probeStatus,
      readyPollMs: 5,
      downTimeoutMs: 40,
    });
  });

  afterEach(async () => {
    // Let a pending readiness watcher notice the record is gone.
    sqlite.exec("DELETE FROM settings");
    await Bun.sleep(20);
    resetCommandRunner();
    setDevStackRuntime(null);
  });

  it("is unsupported outside alumni_connect", async () => {
    expect((await getDevStackStatus(3)).supported).toBe(false);
    await expect(bootDevStack(3)).rejects.toMatchObject({ code: "DEV_STACK_UNSUPPORTED" });
  });

  it("detaches the main checkout at the local branch and stays booting until the site answers", async () => {
    const started = await bootDevStack(1);
    expect(started.state).toBe("starting");
    await Bun.sleep(30);

    let { stack } = await getDevStackStatus(1);
    expect(stack).toMatchObject({ taskId: 1, branch: "fix/EV-1", state: "starting", pid: 4001, alive: true });
    expect(stack?.detail).toContain("bundler");
    expect(commands).toContain("git fetch origin fix/EV-1");
    expect(commands).toContain("git switch --detach fix/EV-1");
    expect(spawned).toBe(1);

    // Bundler compiled but nginx still answers 502 for the web app.
    appendFileSync(LOG, COMPILED_LINE);
    probeStatus = 502;
    await Bun.sleep(30);
    ({ stack } = await getDevStackStatus(1));
    expect(stack?.state).toBe("starting");
    expect(stack?.detail).toContain("HTTP 502");

    probeStatus = 200;
    await devStackSettled();
    ({ stack } = await getDevStackStatus(1));
    expect(stack).toMatchObject({ state: "up", detail: null });
  });

  const ready = () => {
    compiled = true;
    probeStatus = 200;
  };

  it("falls back to origin when the branch only exists remotely", async () => {
    localBranch = false;
    ready();
    await bootDevStack(1);
    await devStackSettled();
    expect(commands).toContain("git switch --detach origin/fix/EV-1");
  });

  it("refuses a dirty main checkout", async () => {
    dirty = true;
    await bootDevStack(1);
    await devStackSettled();
    const { stack } = await getDevStackStatus(1);
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toContain("changed files");
    expect(commands.some((c) => c.startsWith("git switch"))).toBe(false);
    expect(spawned).toBe(0);
  });

  it("refuses to boot while another task owns the stack", async () => {
    ready();
    await bootDevStack(1);
    await devStackSettled();
    await expect(bootDevStack(2)).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
    await expect(stopDevStack(2)).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
    // Booting the owner again is a no-op.
    expect((await bootDevStack(1)).state).toBe("up");
    expect(spawned).toBe(1);
  });

  it("kills a leftover process tree before rebooting a failed stack", async () => {
    ready();
    await bootDevStack(1);
    await devStackSettled();
    expect(spawned).toBe(1);
    expect(alive).toBe(true);

    // Simulate a crash whose EXIT trap killed Docker but left the dev-server
    // supervisor tree running past the recorded pid.
    sqlite.exec(
      `UPDATE settings SET value = '${JSON.stringify({
        taskId: 1,
        branch: "fix/EV-1",
        state: "failed",
        pid: 4001,
        detail: null,
        error: "boom",
        startedAt: "2026-01-01T00:00:00.000Z",
      })}' WHERE key = 'dev_stack'`,
    );

    await bootDevStack(1);
    await devStackSettled();
    expect(killTreeCalls).toEqual([4001]);
    expect(spawned).toBe(2);
  });

  it("fails fast when the docker stack disappears once the bundler compiles", async () => {
    compiled = true;
    probeStatus = null; // gateway never comes back
    running = 0; // containers already torn down
    await bootDevStack(1);
    await devStackSettled();
    const { stack } = await getDevStackStatus(1);
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toContain("not running");
  });

  it("stops the stack, switches back to the base branch and clears the record", async () => {
    ready();
    await bootDevStack(1);
    await devStackSettled();
    commands.length = 0;

    running = 3;
    const stopping = await stopDevStack(1);
    expect(stopping.state).toBe("stopping");
    await Bun.sleep(20);

    // Containers still winding down: keep stopping, do not switch yet.
    let { stack } = await getDevStackStatus(1);
    expect(stack?.state).toBe("stopping");
    expect(stack?.detail).toContain("3 container(s)");
    expect(commands[0]).toBe("/bin/zsh -lc bin/dev stop-dev-server; bin/dev dc stop");
    expect(commands).not.toContain("git switch sprint");

    running = 0;
    await devStackSettled();
    expect(commands).toContain("git reset --hard");
    expect(commands).toContain("git switch sprint");
    expect((await getDevStackStatus(1)).stack).toBeNull();
  });

  it("hard resets the checkout before switching back, even with schema.rb left dirty", async () => {
    ready();
    await bootDevStack(1);
    await devStackSettled();
    commands.length = 0;
    dirty = true; // boot commands (bin/dev migration) leave db/schema.rb modified
    running = 0;

    await stopDevStack(1);
    await devStackSettled();
    const resetIndex = commands.indexOf("git reset --hard");
    const switchIndex = commands.indexOf("git switch sprint");
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(switchIndex).toBeGreaterThan(resetIndex);
    expect((await getDevStackStatus(1)).stack).toBeNull();
  });

  it("fails the stop when containers never go away", async () => {
    ready();
    await bootDevStack(1);
    await devStackSettled();
    running = 2;
    await stopDevStack(1);
    await devStackSettled(); // downTimeoutMs is tiny in tests
    const { stack } = await getDevStackStatus(1);
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toContain("2 container(s)");
    expect(commands).not.toContain("git switch sprint");
  });
});
