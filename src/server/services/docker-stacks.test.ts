import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import { ensureStackCapacity, listProjectVolumes, listRunningTaskStacks, sweepIdleStacks } from "./docker-stacks";

const ok = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
const MAIN = "/repo/alumni_connect";
const wt = (key: string) => `${MAIN}.${key}`;

describe("docker stacks", () => {
  const commands: string[] = [];
  let psOutput = "";

  beforeAll(() => createTestTables(sqlite));

  beforeEach(() => {
    commands.length = 0;
    for (const t of ["claude_sessions", "task_worktrees", "tasks", "repositories"]) sqlite.run(`DELETE FROM ${t}`);
    sqlite.run(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1)`);
    const ts = "'2026-01-01T00:00:00.000Z'";
    for (const id of [1, 2, 3, 4]) {
      sqlite.run(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, repository_id) VALUES (${id}, 't${id}', 'In Progress', ${ts}, ${ts}, 'EV-${id}', 1)`);
      sqlite.run(`INSERT INTO task_worktrees (task_id, repository_id, path, state, created_at, updated_at) VALUES (${id}, 1, '${wt(`EV-${id}`)}', 'ready', ${ts}, ${ts})`);
    }
    // main stack + three task stacks running
    psOutput = [
      `alumni_connect\t${MAIN}`,
      `alumni_connect_ev_1\t${wt("EV-1")}`,
      `alumni_connect_ev_1\t${wt("EV-1")}`,
      `alumni_connect_ev_2\t${wt("EV-2")}`,
      `alumni_connect_ev_3\t${wt("EV-3")}`,
    ].join("\n");
    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      if (cmd === "docker" && args[0] === "ps") return ok(psOutput);
      return ok();
    });
  });

  afterEach(() => resetCommandRunner());

  const session = (taskId: number, state: string, updatedAt: string) =>
    sqlite.run(`INSERT INTO claude_sessions (task_id, chore_key, chore_name, prompt, cwd, name, state, created_at, updated_at, claude_updated_at)
      VALUES (${taskId}, 'x', 'X', '/x', '${wt(`EV-${taskId}`)}', 'n', '${state}', '${updatedAt}', '${updatedAt}', '${updatedAt}')`);

  it("ignores the main checkout and dedupes containers per project", async () => {
    const stacks = await listRunningTaskStacks();
    expect(stacks.map((s) => s.project).sort()).toEqual(["alumni_connect_ev_1", "alumni_connect_ev_2", "alumni_connect_ev_3"]);
  });

  it("lists a project's volumes by exact prefix, or null when Docker is down", async () => {
    setCommandRunner(async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      return ok("alumni_connect_ev_1_bundle\nold_alumni_connect_ev_1_bundle\nalumni_connect_ev_1_postgres-15-volume\n");
    });
    expect(await listProjectVolumes("alumni_connect_ev_1")).toEqual([
      "alumni_connect_ev_1_bundle",
      "alumni_connect_ev_1_postgres-15-volume",
    ]);
    expect(commands).toEqual(["docker volume ls --format {{.Name}} --filter name=alumni_connect_ev_1_"]);

    setCommandRunner(async () => ({ stdout: "", stderr: "Cannot connect to the Docker daemon", exitCode: 1 }));
    expect(await listProjectVolumes("alumni_connect_ev_1")).toBeNull();
  });

  it("stops idle stacks but keeps working and recently active ones", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    session(1, "working", old);
    session(2, "done", recent);
    session(3, "done", old);
    const stopped = await sweepIdleStacks();
    expect(stopped).toEqual(["alumni_connect_ev_3"]);
    expect(commands).toContain("docker compose -p alumni_connect_ev_3 stop");
  });

  it("evicts the least recently active idle stack when the cap is reached", async () => {
    session(1, "working", "2026-01-01T00:00:00.000Z");
    session(2, "done", "2026-01-01T02:00:00.000Z");
    session(3, "done", "2026-01-01T01:00:00.000Z");
    expect(await ensureStackCapacity(wt("EV-4"))).toBe("ok");
    expect(commands).toContain("docker compose -p alumni_connect_ev_3 stop");
    expect(commands).not.toContain("docker compose -p alumni_connect_ev_2 stop");
  });

  it("counts a sub-task's sessions toward its parent's stack", async () => {
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.run(`INSERT INTO tasks (id, title, status, created_at, updated_at, jira_key, parent_key, repository_id) VALUES (5, 't5', 'In Progress', ${ts}, ${ts}, 'EV-5', 'EV-3', 1)`);
    const recent = new Date(Date.now() - 60_000).toISOString();
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    for (const id of [1, 2, 3]) session(id, "done", old);
    session(5, "working", old);
    const stopped = await sweepIdleStacks();
    expect(stopped.sort()).toEqual(["alumni_connect_ev_1", "alumni_connect_ev_2"]);

    commands.length = 0;
    sqlite.run(`UPDATE claude_sessions SET state = 'done', updated_at = '${recent}', claude_updated_at = '${recent}' WHERE task_id = 5`);
    expect(await ensureStackCapacity(wt("EV-4"))).toBe("ok");
    expect(commands).not.toContain("docker compose -p alumni_connect_ev_3 stop");
  });

  it("queues when every running stack has a working session", async () => {
    for (const id of [1, 2, 3]) session(id, "working", "2026-01-01T00:00:00.000Z");
    expect(await ensureStackCapacity(wt("EV-4"))).toBe("queued");
    expect(commands.some((c) => c.includes("stop"))).toBe(false);
  });

  it("lets a task whose stack is already running proceed", async () => {
    for (const id of [1, 2, 3]) session(id, "working", "2026-01-01T00:00:00.000Z");
    expect(await ensureStackCapacity(wt("EV-2"))).toBe("ok");
  });
});
