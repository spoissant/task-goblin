import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTaskTools } from "./tasks";

/** Answers the MCP server's API calls from a "METHOD /path" → [status, body] table and records them. */
function stubApi(routes: Record<string, [number, unknown]>): string[] {
  const calls: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
    const call = `${init?.method ?? "GET"} ${new URL(String(input)).pathname}`;
    calls.push(call);
    const [status, body] = routes[call] ?? [404, { error: { code: "NOT_FOUND", message: `No stub for ${call}` } }];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch);
  return calls;
}

let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: "task-goblin", version: "0.0.0" });
  registerTaskTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  mock.restore();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content!.text };
}

describe("sync", () => {
  it("runs one full pass and returns its result", async () => {
    const pass = { jira: null, github: { synced: 2, new: 1, updated: 1, unchanged: 0 }, errors: [{ step: "jira", message: "auth" }] };
    const calls = stubApi({ "POST /api/v1/sync": [200, pass] });

    expect(await call("sync")).toEqual({ isError: false, text: JSON.stringify(pass) });
    expect(calls).toEqual(["POST /api/v1/sync"]);
  });
});

describe("sync_task", () => {
  it("resolves the task, then syncs it on the server", async () => {
    const synced = { task: { id: 7, jiraKey: "EV-1" }, errors: ["GitHub: rate limited"] };
    const calls = stubApi({
      "GET /api/v1/tasks/by-jira-key/EV-1": [200, { id: 7 }],
      "POST /api/v1/tasks/7/sync": [200, synced],
    });

    expect(await call("sync_task", { jiraKey: "EV-1" })).toEqual({ isError: false, text: JSON.stringify(synced) });
    expect(calls).toEqual(["GET /api/v1/tasks/by-jira-key/EV-1", "POST /api/v1/tasks/7/sync"]);
  });

  it("returns the API's error for an unknown task", async () => {
    stubApi({ "POST /api/v1/tasks/99/sync": [404, { error: { code: "NOT_FOUND", message: "Task 99 not found" } }] });

    expect(await call("sync_task", { id: 99 })).toEqual({ isError: true, text: "Error: Task 99 not found" });
  });
});
