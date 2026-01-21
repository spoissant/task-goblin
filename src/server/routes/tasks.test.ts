import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createRouter } from "../router";
import { routes } from "./index";
import { withErrorBoundary } from "../middleware";
import { createTestTables } from "../../test/createSchema";

let router: ReturnType<typeof createRouter>;

beforeAll(() => {
  // Create tables from Drizzle schema - always stays in sync
  createTestTables(sqlite);

  router = createRouter(routes);
});

beforeEach(() => {
  // Clear all tables before each test
  sqlite.exec("DELETE FROM blocked_by");
  sqlite.exec("DELETE FROM logs");
  sqlite.exec("DELETE FROM todos");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM repositories");
  sqlite.exec("DELETE FROM settings");
});

// Helper to make requests
async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return withErrorBoundary(() => router.route(req));
}

describe("Health endpoint", () => {
  it("returns ok status", async () => {
    const res = await request("GET", "/api/v1/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.timestamp).toBeDefined();
  });
});

describe("Tasks endpoints", () => {
  it("returns list with items and total", async () => {
    const res = await request("GET", "/api/v1/tasks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  it("creates a task", async () => {
    const res = await request("POST", "/api/v1/tasks", {
      title: "Test task",
      description: "A test description",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.title).toBe("Test task");
    expect(data.description).toBe("A test description");
    expect(data.status).toBe("todo");
  });

  it("validates required title", async () => {
    const res = await request("POST", "/api/v1/tasks", {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates status enum", async () => {
    const res = await request("POST", "/api/v1/tasks", {
      title: "Test",
      status: "invalid",
    });
    expect(res.status).toBe(400);
  });

  it("gets a task by id", async () => {
    // Create first
    const createRes = await request("POST", "/api/v1/tasks", {
      title: "Get test",
    });
    const created = await createRes.json();

    const res = await request("GET", `/api/v1/tasks/${created.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(created.id);
    expect(data.title).toBe("Get test");
  });

  it("returns 404 for non-existent task", async () => {
    const res = await request("GET", "/api/v1/tasks/9999");
    expect(res.status).toBe(404);
  });

  it("updates a task", async () => {
    const createRes = await request("POST", "/api/v1/tasks", {
      title: "Original",
    });
    const created = await createRes.json();

    const res = await request("PUT", `/api/v1/tasks/${created.id}`, {
      title: "Updated",
      status: "in_progress",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Updated");
    expect(data.status).toBe("in_progress");
  });

  it("patches a task", async () => {
    const createRes = await request("POST", "/api/v1/tasks", {
      title: "Original",
    });
    const created = await createRes.json();

    const res = await request("PATCH", `/api/v1/tasks/${created.id}`, {
      status: "done",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Original");
    expect(data.status).toBe("done");
  });

  it("deletes a task", async () => {
    const createRes = await request("POST", "/api/v1/tasks", {
      title: "To delete",
    });
    const created = await createRes.json();

    const res = await request("DELETE", `/api/v1/tasks/${created.id}`);
    expect(res.status).toBe(204);

    const getRes = await request("GET", `/api/v1/tasks/${created.id}`);
    expect(getRes.status).toBe(404);
  });
});

describe("Todos endpoints", () => {
  it("creates a todo", async () => {
    const res = await request("POST", "/api/v1/todos", {
      content: "Test todo",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.content).toBe("Test todo");
    expect(data.done).toBeNull();
  });

  it("toggles a todo", async () => {
    const createRes = await request("POST", "/api/v1/todos", {
      content: "Toggle me",
    });
    const created = await createRes.json();
    expect(created.done).toBeNull();

    const toggleRes = await request(
      "POST",
      `/api/v1/todos/${created.id}/toggle`
    );
    const toggled = await toggleRes.json();
    expect(toggled.done).not.toBeNull();

    const toggleRes2 = await request(
      "POST",
      `/api/v1/todos/${created.id}/toggle`
    );
    const toggled2 = await toggleRes2.json();
    expect(toggled2.done).toBeNull();
  });

  it("creates todo at start with placement='start'", async () => {
    // Create first todo (position 1)
    const res1 = await request("POST", "/api/v1/todos", { content: "First" });
    const todo1 = await res1.json();
    expect(todo1.position).toBe(1);

    // Create second todo at end (position 2)
    const res2 = await request("POST", "/api/v1/todos", { content: "Second" });
    const todo2 = await res2.json();
    expect(todo2.position).toBe(2);

    // Create third todo at start - should shift others
    const res3 = await request("POST", "/api/v1/todos", {
      content: "Third at start",
      placement: "start",
    });
    const todo3 = await res3.json();
    expect(todo3.position).toBe(1);

    // Verify positions shifted: Third=1, First=2, Second=3
    const listRes = await request("GET", "/api/v1/todos");
    const list = await listRes.json();
    const sorted = list.items.sort((a: { position: number }, b: { position: number }) => a.position - b.position);
    expect(sorted[0].content).toBe("Third at start");
    expect(sorted[0].position).toBe(1);
    expect(sorted[1].content).toBe("First");
    expect(sorted[1].position).toBe(2);
    expect(sorted[2].content).toBe("Second");
    expect(sorted[2].position).toBe(3);
  });

  it("creates todo at end with placement='end' (default)", async () => {
    // Create first todo
    const res1 = await request("POST", "/api/v1/todos", { content: "First" });
    const todo1 = await res1.json();
    expect(todo1.position).toBe(1);

    // Create second todo with explicit 'end' placement
    const res2 = await request("POST", "/api/v1/todos", {
      content: "Second at end",
      placement: "end",
    });
    const todo2 = await res2.json();
    expect(todo2.position).toBe(2);

    // Verify first todo position unchanged
    const listRes = await request("GET", "/api/v1/todos");
    const list = await listRes.json();
    const first = list.items.find((t: { content: string }) => t.content === "First");
    expect(first.position).toBe(1);
  });
});

describe("Settings endpoints", () => {
  it("gets settings as object", async () => {
    const res = await request("GET", "/api/v1/settings");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data).toBe("object");
  });

  it("creates and retrieves a setting", async () => {
    const uniqueKey = `test_key_${Date.now()}`;
    await request("POST", "/api/v1/settings", {
      key: uniqueKey,
      value: "test_value",
    });

    const res = await request("GET", `/api/v1/settings/${uniqueKey}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.key).toBe(uniqueKey);
    expect(data.value).toBe("test_value");

    // Cleanup
    await request("DELETE", `/api/v1/settings/${uniqueKey}`);
  });
});

describe("Router", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request("GET", "/api/v1/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await request("PUT", "/api/v1/health");
    expect(res.status).toBe(405);
  });
});
