import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { appendFileSync } from "fs";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import {
  bootDevStack,
  devStackLoginLink,
  devStackSettled,
  getDevStackOverview,
  getDevStackStatus,
  refreshDevStack,
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
  let conflictOn: string | null = null; // branch whose merge conflicts
  const killTreeCalls: number[] = [];
  const spawnedCommands: string[] = [];
  const LOG = process.env.DEV_STACK_LOG!;
  const COMPILED_LINE = "\n  \u001b[32m✓\u001b[39m Compiled successfully 14.97s\n";
  const STORYBOOK_LINE = "\n╭──────────╮\n│  Storybook ready!  │\n";

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
    conflictOn = null;
    killTreeCalls.length = 0;
    spawnedCommands.length = 0;
    for (const t of ["settings", "tasks", "worktrees", "repositories"]) sqlite.exec(`DELETE FROM ${t}`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled, default_base_branch) VALUES (1, 'hb', 'alumni_connect', 1, 'sprint')`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (2, 'hb', 'front-monorepo', 1)`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (3, 'hb', 'harborhive', 1)`);
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO worktrees (repository_id, path, created_at, updated_at) VALUES (1, '${MAIN}', ${ts}, ${ts})`);
    sqlite.exec(`INSERT INTO worktrees (repository_id, path, created_at, updated_at) VALUES (2, '${MAIN}', ${ts}, ${ts})`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (1, 't1', 'In Progress', ${ts}, ${ts}, 1, 'fix/EV-1')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (2, 't2', 'In Progress', ${ts}, ${ts}, 1, 'fix/EV-2')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (3, 't3', 'In Progress', ${ts}, ${ts}, 2, 'feat/x')`);
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (4, 't4', 'In Progress', ${ts}, ${ts}, 3, 'feat/y')`);

    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      if (cmd === "git" && args[0] === "status") return ok(dirty ? " M app.rb" : "");
      if (cmd === "git" && args.includes("merge") && conflictOn && args.includes(conflictOn)) {
        return { stdout: "", stderr: "CONFLICT", exitCode: 1 };
      }
      if (cmd === "git" && args[0] === "diff" && args.includes("--diff-filter=U")) return ok(conflictOn ? "app.rb" : "");
      if (cmd === "docker" && args[0] === "ps") return ok(Array.from({ length: running }, (_, i) => `c${i}`).join("\n"));
      if (cmd === "/bin/zsh" && args[1]?.includes("stop-dev-server")) alive = false; // the stop command ends the bundler
      if (cmd === "git" && args[0] === "rev-parse" && args.includes("refs/heads/fix/EV-1")) {
        return localBranch ? ok("abc") : { stdout: "", stderr: "", exitCode: 1 };
      }
      return ok();
    });
    setDevStackRuntime({
      spawn(_cwd, command, logPath) {
        spawned++;
        spawnedCommands.push(command);
        alive = true;
        // Boot truncates the log first, so the ready line goes in here when the test wants it.
        if (compiled) appendFileSync(logPath, command.includes("storybook") ? STORYBOOK_LINE : COMPILED_LINE);
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

  it("is unsupported outside alumni_connect and front-monorepo", async () => {
    expect((await getDevStackStatus({ taskId: 4 })).supported).toBe(false);
    await expect(bootDevStack({ taskId: 4 })).rejects.toMatchObject({ code: "DEV_STACK_UNSUPPORTED" });
  });

  it("detaches the main checkout at the local branch and stays booting until the site answers", async () => {
    const started = await bootDevStack({ taskId: 1 });
    expect(started.state).toBe("starting");
    await Bun.sleep(30);

    let { stack } = await getDevStackStatus({ taskId: 1 });
    expect(stack).toMatchObject({ taskId: 1, branch: "fix/EV-1", state: "starting", pid: 4001, alive: true });
    expect(stack?.detail).toContain("bundler");
    expect(commands).toContain("git fetch origin fix/EV-1");
    expect(commands).toContain("git switch --detach fix/EV-1");
    expect(spawned).toBe(1);

    // Bundler compiled but nginx still answers 502 for the web app.
    appendFileSync(LOG, COMPILED_LINE);
    probeStatus = 502;
    await Bun.sleep(30);
    ({ stack } = await getDevStackStatus({ taskId: 1 }));
    expect(stack?.state).toBe("starting");
    expect(stack?.detail).toContain("HTTP 502");

    probeStatus = 200;
    await devStackSettled();
    ({ stack } = await getDevStackStatus({ taskId: 1 }));
    expect(stack).toMatchObject({ state: "up", detail: null });
  });

  const ready = () => {
    compiled = true;
    probeStatus = 200;
  };

  it("falls back to origin when the branch only exists remotely", async () => {
    localBranch = false;
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    expect(commands).toContain("git switch --detach origin/fix/EV-1");
  });

  it("boots, refreshes and stops a PR without a task at its pull head", async () => {
    ready();
    const pr = { prUrl: "https://github.com/hb/alumni_connect/pull/42" };
    await bootDevStack(pr);
    await devStackSettled();
    expect((await getDevStackStatus(pr)).stack).toMatchObject({ taskId: null, prUrl: pr.prUrl, branch: "alumni_connect#42", state: "up" });
    expect(commands).toContain("git fetch origin pull/42/head");
    expect(commands).toContain("git switch --detach FETCH_HEAD");
    await expect(bootDevStack({ taskId: 1 })).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });

    commands.length = 0;
    await refreshDevStack(pr);
    expect(commands).toContain("git switch --detach --discard-changes FETCH_HEAD");

    running = 0;
    await stopDevStack(pr);
    await devStackSettled();
    expect(commands).toContain("git switch sprint");
    expect((await getDevStackStatus(pr)).stack).toBeNull();
  });

  it("is unsupported for PRs of other repositories", async () => {
    await expect(bootDevStack({ prUrl: "https://github.com/hb/harborhive/pull/7" })).rejects.toMatchObject({ code: "DEV_STACK_UNSUPPORTED" });
  });

  it("runs Storybook for front-monorepo next to the alumni_connect stack", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await bootDevStack({ taskId: 3 });
    await devStackSettled();

    expect(spawnedCommands[1]).toBe("pnpm install --frozen-lockfile --config.confirmModulesPurge=false && pnpm nx run storybook:dev");
    expect(commands).toContain("git switch --detach feat/x");
    const overview = await getDevStackOverview();
    expect(overview.supportedRepositoryIds.sort()).toEqual([1, 2]);
    expect(overview.stacks.map((s) => [s.repositoryId, s.branch, s.state, s.url])).toEqual([
      [1, "fix/EV-1", "up", "http://localhost.hvbrt.com"],
      [2, "feat/x", "up", "http://localhost:4400"],
    ]);

    // Stopping Storybook kills its process tree (no stop command, no Docker) and leaves alumni_connect up.
    commands.length = 0;
    running = 5;
    await stopDevStack({ taskId: 3 });
    await devStackSettled();
    expect(killTreeCalls).toEqual([4002]);
    expect(commands.some((c) => c.startsWith("/bin/zsh") || c.startsWith("docker"))).toBe(false);
    expect(commands).toContain("git switch main");
    expect((await getDevStackStatus({ taskId: 3 })).stack).toBeNull();
    expect((await getDevStackStatus({ taskId: 1 })).stack?.state).toBe("up");
  });

  it("refuses a dirty main checkout", async () => {
    dirty = true;
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    const { stack } = await getDevStackStatus({ taskId: 1 });
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toContain("changed files");
    expect(commands.some((c) => c.startsWith("git switch"))).toBe(false);
    expect(spawned).toBe(0);
  });

  it("refuses to boot while another task owns the stack", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    await expect(bootDevStack({ taskId: 2 })).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
    await expect(stopDevStack({ taskId: 2 })).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
    // Booting the owner again is a no-op.
    expect((await bootDevStack({ taskId: 1 })).state).toBe("up");
    expect(spawned).toBe(1);
  });

  it("kills a leftover process tree before rebooting a failed stack", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
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

    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    expect(killTreeCalls).toEqual([4001]);
    expect(spawned).toBe(2);
  });

  it("fails fast when the docker stack disappears once the bundler compiles", async () => {
    compiled = true;
    probeStatus = null; // gateway never comes back
    running = 0; // containers already torn down
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    const { stack } = await getDevStackStatus({ taskId: 1 });
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toContain("not running");
  });

  it("stops the stack, switches back to the base branch and clears the record", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    commands.length = 0;

    running = 3;
    const stopping = await stopDevStack({ taskId: 1 });
    expect(stopping.state).toBe("stopping");
    await Bun.sleep(20);

    // Containers still winding down: keep stopping, do not switch yet.
    let { stack } = await getDevStackStatus({ taskId: 1 });
    expect(stack?.state).toBe("stopping");
    expect(stack?.detail).toContain("3 container(s)");
    expect(commands[0]).toBe("/bin/zsh -lc bin/dev stop-dev-server; bin/dev dc stop");
    expect(commands).not.toContain("git switch sprint");

    running = 0;
    await devStackSettled();
    expect(commands).toContain("git reset --hard");
    expect(commands).toContain("git switch sprint");
    expect((await getDevStackStatus({ taskId: 1 })).stack).toBeNull();
  });

  it("hard resets the checkout before switching back, even with schema.rb left dirty", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    commands.length = 0;
    dirty = true; // boot commands (bin/dev migration) leave db/schema.rb modified
    running = 0;

    await stopDevStack({ taskId: 1 });
    await devStackSettled();
    const resetIndex = commands.indexOf("git reset --hard");
    const switchIndex = commands.indexOf("git switch sprint");
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(switchIndex).toBeGreaterThan(resetIndex);
    expect((await getDevStackStatus({ taskId: 1 })).stack).toBeNull();
  });

  it("refreshes a running stack to the latest branch commit without restarting it", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    commands.length = 0;

    await refreshDevStack({ taskId: 1 });
    expect(commands).toContain("git fetch origin fix/EV-1");
    expect(commands).toContain("git switch --detach --discard-changes fix/EV-1");
    expect(spawned).toBe(1);
    expect((await getDevStackStatus({ taskId: 1 })).stack?.state).toBe("up");
  });

  it("refuses to refresh a stack that is not up or belongs to another task", async () => {
    await expect(refreshDevStack({ taskId: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await bootDevStack({ taskId: 1 }); // stays starting: never compiles
    await Bun.sleep(20);
    await expect(refreshDevStack({ taskId: 1 })).rejects.toMatchObject({ code: "DEV_STACK_NOT_UP" });
    await expect(refreshDevStack({ taskId: 2 })).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
  });

  it("merges other tasks' branches on top of the owner's and lets each of them act as owner", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id, head_branch) VALUES (5, 't5', 'In Progress', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1, 'fix/EV-5')`);
    ready();
    await bootDevStack({ taskId: 1 }, [2, 5, 1]);
    await devStackSettled();

    const switchIndex = commands.indexOf("git switch --detach fix/EV-1");
    const mergeIndex = commands.indexOf("git -c core.hooksPath=/dev/null merge --no-edit fix/EV-2");
    expect(switchIndex).toBeGreaterThanOrEqual(0);
    expect(mergeIndex).toBeGreaterThan(switchIndex);
    expect(commands).toContain("git -c core.hooksPath=/dev/null merge --no-edit fix/EV-5");

    const { stack } = await getDevStackStatus({ taskId: 2 });
    expect(stack).toMatchObject({ taskId: 1, branch: "fix/EV-1", mergedTaskIds: [2, 5], state: "up" });
    expect(stack).not.toHaveProperty("merged");

    // Same set again returns the running stack; another set is refused.
    expect((await bootDevStack({ taskId: 1 }, [5, 2])).state).toBe("up");
    await expect(bootDevStack({ taskId: 1 })).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
    await expect(bootDevStack({ taskId: 2 })).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });

    commands.length = 0;
    await refreshDevStack({ taskId: 5 });
    expect(commands).toContain("git switch --detach --discard-changes fix/EV-1");
    expect(commands).toContain("git -c core.hooksPath=/dev/null merge --no-edit fix/EV-2");

    running = 0;
    await stopDevStack({ taskId: 2 });
    await devStackSettled();
    expect((await getDevStackStatus({ taskId: 1 })).stack).toBeNull();
  });

  it("fails the boot when a merged branch conflicts, and reboots a different set after", async () => {
    conflictOn = "fix/EV-2";
    ready();
    await bootDevStack({ taskId: 1 }, [2]);
    await devStackSettled();

    const { stack } = await getDevStackStatus({ taskId: 1 });
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toBe("fix/EV-2 does not merge cleanly on top of fix/EV-1: app.rb");
    expect(commands).toContain("git merge --abort");
    expect(spawned).toBe(0);

    conflictOn = null;
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    expect((await getDevStackStatus({ taskId: 1 })).stack).toMatchObject({ state: "up", mergedTaskIds: [] });
  });

  it("refuses to merge tasks of another repository or without a branch", async () => {
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id) VALUES (6, 't6', 'In Progress', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`);
    await expect(bootDevStack({ taskId: 1 }, [3])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(bootDevStack({ taskId: 1 }, [6])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(bootDevStack({ taskId: 1 }, [99])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mints a login link through rails runner in the main checkout", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    const zshArgs: string[][] = [];
    setCommandRunner(async (cmd, args) => {
      if (cmd === "/bin/zsh") zshArgs.push(args);
      return ok('W, deprecation noise\n{"url":"http://pandora.localhost.hvbrt.com/log-as/claim?token=t","subjectId":7,"name":"Ann","networkId":1}');
    });

    const link = await devStackLoginLink({ taskId: 1 }, "member", 7);
    expect(link).toEqual({ url: "http://pandora.localhost.hvbrt.com/log-as/claim?token=t", subjectId: 7, name: "Ann", networkId: 1 });
    expect(zshArgs[0][1]).toBe('bin/dev dcx webapp bundle exec rails runner "$0" "$@"');
    expect(zshArgs[0][2]).toContain("LogAs::Grant.generate");
    expect(zshArgs[0].slice(3)).toEqual(["member", "7"]);

    await devStackLoginLink({ taskId: 1 }, "super_admin", null);
    expect(zshArgs[1].slice(3)).toEqual(["super_admin", ""]);
  });

  it("refuses login links when the script fails or the stack is not this task's or not alumni_connect", async () => {
    await expect(devStackLoginLink({ taskId: 1 }, "member", null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(devStackLoginLink({ taskId: 3 }, "member", null)).rejects.toMatchObject({ code: "DEV_STACK_UNSUPPORTED" });
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    await expect(devStackLoginLink({ taskId: 2 }, "member", null)).rejects.toMatchObject({ code: "DEV_STACK_BUSY" });
    setCommandRunner(async () => ({ stdout: "", stderr: "No member found with id 9", exitCode: 1 }));
    await expect(devStackLoginLink({ taskId: 1 }, "member", 9)).rejects.toMatchObject({
      code: "DEV_STACK_LOGIN_FAILED",
      message: expect.stringContaining("No member found with id 9"),
    });
  });

  it("fails the stop when containers never go away", async () => {
    ready();
    await bootDevStack({ taskId: 1 });
    await devStackSettled();
    running = 2;
    await stopDevStack({ taskId: 1 });
    await devStackSettled(); // downTimeoutMs is tiny in tests
    const { stack } = await getDevStackStatus({ taskId: 1 });
    expect(stack?.state).toBe("failed");
    expect(stack?.error).toContain("2 container(s)");
    expect(commands).not.toContain("git switch sprint");
  });
});
