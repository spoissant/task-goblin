import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { createRouter, type Routes } from "../router";
import { routes } from "../routes";
import { withErrorBoundary } from "../middleware";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import { reconcileStandups, STANDUP_ARGS } from "./standup";

describe("standups", () => {
  let router: ReturnType<typeof createRouter>;
  const calls: string[][] = [];

  const request = (method: string, path: string) =>
    withErrorBoundary(() => router.route(new Request("http://localhost" + path, { method })));
  const list = async () => (await (await request("GET", "/api/v1/standups")).json()).items;
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const runWith = (res: CommandResult) =>
    setCommandRunner(async (cmd, args) => {
      calls.push([cmd, ...args]);
      return res;
    });

  beforeAll(() => {
    createTestTables(sqlite);
    router = createRouter(routes as Routes);
  });

  beforeEach(() => {
    calls.length = 0;
    sqlite.run("DELETE FROM standups");
  });

  afterEach(() => resetCommandRunner());

  it("runs the skill headless and keeps its final message, cost and duration", async () => {
    const stdout = JSON.stringify({ result: "## Standup\n- EV-1 done\n", is_error: false, total_cost_usd: 0.31, duration_ms: 39000 });
    runWith({ stdout, stderr: "", exitCode: 0 });

    const res = await request("POST", "/api/v1/standups");
    expect(res.status).toBe(202);
    expect((await res.json()).state).toBe("running");
    await settle();

    expect(calls).toEqual([["claude", ...STANDUP_ARGS]]);
    const [row] = await list();
    expect(row).toMatchObject({ state: "done", markdown: "## Standup\n- EV-1 done", costUsd: 0.31, durationMs: 39000, error: null });
  });

  it("allows one run at a time", async () => {
    let release: (r: CommandResult) => void = () => {};
    setCommandRunner(() => new Promise((r) => (release = r)));

    expect((await request("POST", "/api/v1/standups")).status).toBe(202);
    const dup = await request("POST", "/api/v1/standups");
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("STANDUP_RUNNING");

    release({ stdout: JSON.stringify({ result: "ok" }), stderr: "", exitCode: 0 });
    await settle();
    expect((await request("POST", "/api/v1/standups")).status).toBe(202);
  });

  it("records failures from the CLI and from the session", async () => {
    runWith({ stdout: "", stderr: "claude: command not found", exitCode: 127 });
    await request("POST", "/api/v1/standups");
    await settle();

    runWith({ stdout: JSON.stringify({ result: "API overloaded", is_error: true, total_cost_usd: 0.01 }), stderr: "", exitCode: 1 });
    await request("POST", "/api/v1/standups");
    await settle();

    const [session, cli] = await list();
    expect(cli).toMatchObject({ state: "failed", error: "claude -p exited 127: claude: command not found", markdown: null });
    expect(session).toMatchObject({ state: "failed", error: "claude -p exited 1: API overloaded", costUsd: 0.01 });
  });

  it("fails runs left over from a server restart", async () => {
    sqlite.run("INSERT INTO standups (state, created_at, updated_at) VALUES ('running', 'x', 'x'), ('done', 'x', 'x')");
    await reconcileStandups();
    const items = await list();
    expect(items.map((s: { state: string }) => s.state)).toEqual(["done", "failed"]);
    expect(items[1].error).toBe("Interrupted by a server restart");
  });
});
