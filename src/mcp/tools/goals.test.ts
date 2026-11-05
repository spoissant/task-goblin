import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGoalTools } from "./goals";

interface ApiCall {
  call: string;
  body: unknown;
}

/** Answers the MCP server's API calls from a "METHOD /path" → [status, body] table and records them. */
function stubApi(routes: Record<string, [number, unknown]>): ApiCall[] {
  const calls: ApiCall[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
    const call = `${init?.method ?? "GET"} ${new URL(String(input)).pathname}`;
    calls.push({ call, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const [status, body] = routes[call] ?? [404, { error: { code: "NOT_FOUND", message: `No stub for ${call}` } }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch);
  return calls;
}

let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: "task-goblin", version: "0.0.0" });
  registerGoalTools(server);
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

const goal = { id: 7, name: "Editor", context: null, displayOrder: 0, archived: 0 };

describe("list_goals", () => {
  it("lists active goals, or the archived ones on request", async () => {
    const calls = stubApi({
      "GET /api/v1/goals": [200, { items: [goal], total: 1 }],
    });
    expect((await call("list_goals")).text).toContain('"Editor"');
    await call("list_goals", { archived: true });
    expect(calls.map((c) => c.call)).toEqual(["GET /api/v1/goals", "GET /api/v1/goals"]);
  });
});

describe("create_goal", () => {
  it("creates the goal, then moves the given tasks into it", async () => {
    const calls = stubApi({
      "POST /api/v1/goals": [201, goal],
      "PATCH /api/v1/tasks/3": [200, {}],
      "PATCH /api/v1/tasks/4": [200, {}],
    });
    const result = await call("create_goal", { name: "Editor", context: "brief", taskIds: [3, 4] });
    expect(JSON.parse(result.text)).toMatchObject({ goal: { id: 7 }, moved: [3, 4] });
    expect(calls).toEqual([
      { call: "POST /api/v1/goals", body: { name: "Editor", context: "brief" } },
      { call: "PATCH /api/v1/tasks/3", body: { goalId: 7 } },
      { call: "PATCH /api/v1/tasks/4", body: { goalId: 7 } },
    ]);
  });

  it("moves nothing when no tasks are given", async () => {
    const calls = stubApi({ "POST /api/v1/goals": [201, goal] });
    expect(JSON.parse((await call("create_goal", { name: "Editor" })).text).moved).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("update_goal", () => {
  it("sends only the fields passed, null context included", async () => {
    const calls = stubApi({ "PATCH /api/v1/goals/7": [200, goal] });
    await call("update_goal", { id: 7, context: null, archived: true });
    expect(calls[0]).toEqual({ call: "PATCH /api/v1/goals/7", body: { context: null, archived: true } });
  });

  it("sends the epic list, empty to untie every epic", async () => {
    const calls = stubApi({ "PATCH /api/v1/goals/7": [200, goal] });
    await call("update_goal", { id: 7, epicKeys: ["PS-1"] });
    await call("update_goal", { id: 7, epicKeys: [] });
    expect(calls.map((c) => c.body)).toEqual([{ epicKeys: ["PS-1"] }, { epicKeys: [] }]);
  });

  it("returns the API's error", async () => {
    stubApi({ "PATCH /api/v1/goals/9": [404, { error: { code: "NOT_FOUND", message: "Goal 9 not found" } }] });
    const result = await call("update_goal", { id: 9, name: "x" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Goal 9 not found");
  });
});

describe("delete_goal", () => {
  it("deletes the goal", async () => {
    const calls = stubApi({ "DELETE /api/v1/goals/7": [204, null] });
    expect(JSON.parse((await call("delete_goal", { id: 7 })).text)).toEqual({ deleted: 7 });
    expect(calls[0]!.call).toBe("DELETE /api/v1/goals/7");
  });
});

describe("reorder_goals", () => {
  it("puts the order, then returns the new list", async () => {
    const calls = stubApi({
      "PUT /api/v1/goals/order": [204, null],
      "GET /api/v1/goals": [200, { items: [goal], total: 1 }],
    });
    const result = await call("reorder_goals", { ids: [8, 7] });
    expect(result.isError).toBe(false);
    expect(calls[0]).toEqual({ call: "PUT /api/v1/goals/order", body: { ids: [8, 7] } });
    expect(calls[1]!.call).toBe("GET /api/v1/goals");
  });
});

describe("move_tasks_to_goal", () => {
  it("moves tasks into a goal and out of it with null", async () => {
    const calls = stubApi({ "PATCH /api/v1/tasks/3": [200, {}] });
    expect(JSON.parse((await call("move_tasks_to_goal", { taskIds: [3], goalId: 7 })).text)).toEqual({ goalId: 7, moved: [3] });
    await call("move_tasks_to_goal", { taskIds: [3], goalId: null });
    expect(calls.map((c) => c.body)).toEqual([{ goalId: 7 }, { goalId: null }]);
  });

  it("names the tasks already moved when one fails", async () => {
    stubApi({
      "PATCH /api/v1/tasks/3": [200, {}],
      "PATCH /api/v1/tasks/4": [404, { error: { code: "NOT_FOUND", message: "Task 4 not found" } }],
    });
    const result = await call("move_tasks_to_goal", { taskIds: [3, 4, 5], goalId: 7 });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Task 4");
    expect(result.text).toContain("already moved: 3");
  });

  it("rejects an empty task list", async () => {
    stubApi({});
    expect((await call("move_tasks_to_goal", { taskIds: [], goalId: 7 })).isError).toBe(true);
  });
});
