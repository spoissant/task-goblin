import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { createRouter, type Routes } from "../router";
import { routes } from "../routes";
import { withErrorBoundary } from "../middleware";
import { resetCommandRunner, setCommandRunner, type CommandResult } from "../lib/process";
import { CHORE_SESSION_SETTINGS } from "./claude-cli";
import { reconcileStandups } from "./standup";

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
    sqlite.run("DELETE FROM settings");
  });

  afterEach(() => resetCommandRunner());

  it("runs the skill headless and keeps its final message, cost and duration", async () => {
    const stdout = JSON.stringify({ result: "## Standup\n- EV-1 done\n", is_error: false, total_cost_usd: 0.31, duration_ms: 39000 });
    runWith({ stdout, stderr: "", exitCode: 0 });

    const res = await request("POST", "/api/v1/standups");
    expect(res.status).toBe(202);
    expect((await res.json()).state).toBe("running");
    await settle();

    expect(calls).toEqual([
      ["claude", "-p", "/standup", "--output-format", "json", "--model", "sonnet", "--settings", CHORE_SESSION_SETTINGS],
    ]);
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

  it("points the skill's bare-key links at Jira", async () => {
    sqlite.run("INSERT INTO settings (key, value) VALUES ('jira_host', 'https://hb.atlassian.net/')");
    runWith({ stdout: JSON.stringify({ result: "- :merged: - [Fix it](PS-12) and [PR](https://github.com/o/r/pull/1)" }), stderr: "", exitCode: 0 });
    await request("POST", "/api/v1/standups");
    await settle();

    const [row] = await list();
    expect(row.markdown).toBe("- :merged: - [Fix it](https://hb.atlassian.net/browse/PS-12) and [PR](https://github.com/o/r/pull/1)");
  });

  it("drafts a finished standup in Slack with only the read and draft tools", async () => {
    sqlite.run("INSERT INTO standups (id, state, markdown, created_at, updated_at) VALUES (5, 'done', '**TipTap**', 'x', 'x')");
    runWith({ stdout: JSON.stringify({ result: "https://app.slack.com/client/T1/C1\n" }), stderr: "", exitCode: 0 });

    const res = await request("POST", "/api/v1/standups/5/slack-draft");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: "https://app.slack.com/client/T1/C1" });

    const args = calls[0];
    expect(args[2]).toContain("<<<MESSAGE\n**TipTap**\nMESSAGE>>>");
    expect(args.slice(-2)).toEqual([
      "--allowedTools",
      "ToolSearch,mcp__claude_ai_Slack__slack_read_channel,mcp__claude_ai_Slack__slack_send_message_draft",
    ]);
  });

  it("reports why a Slack draft failed", async () => {
    sqlite.run("INSERT INTO standups (id, state, markdown, created_at, updated_at) VALUES (5, 'done', 'x', 'x', 'x')");
    runWith({ stdout: JSON.stringify({ result: "ERROR: no reminder today" }), stderr: "", exitCode: 0 });

    const res = await request("POST", "/api/v1/standups/5/slack-draft");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: "SLACK_DRAFT_FAILED", message: "Slack draft failed: no reminder today" });
  });

  it("drafts only finished standups", async () => {
    sqlite.run("INSERT INTO standups (id, state, created_at, updated_at) VALUES (5, 'running', 'x', 'x')");
    runWith({ stdout: "", stderr: "", exitCode: 0 });

    expect((await request("POST", "/api/v1/standups/5/slack-draft")).status).toBe(409);
    expect((await request("POST", "/api/v1/standups/6/slack-draft")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("fails runs left over from a server restart", async () => {
    sqlite.run("INSERT INTO standups (state, created_at, updated_at) VALUES ('running', 'x', 'x'), ('done', 'x', 'x')");
    await reconcileStandups();
    const items = await list();
    expect(items.map((s: { state: string }) => s.state)).toEqual(["done", "failed"]);
    expect(items[1].error).toBe("Interrupted by a server restart");
  });
});
