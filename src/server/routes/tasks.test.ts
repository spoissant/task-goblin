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
  sqlite.exec("DELETE FROM todos");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM repositories");
  sqlite.exec("DELETE FROM settings");
  sqlite.exec("DELETE FROM status_categories");
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

  it("flags parents with hasChildren, including completed children", async () => {
    await request("POST", "/api/v1/tasks", { title: "Parent story" });
    await request("POST", "/api/v1/tasks", { title: "Epic" });
    await request("POST", "/api/v1/tasks", { title: "Leaf" });
    sqlite.exec("UPDATE tasks SET jira_key = 'PS-1' WHERE title = 'Parent story'");
    sqlite.exec("UPDATE tasks SET jira_key = 'PS-9' WHERE title = 'Epic'");
    sqlite.exec("UPDATE tasks SET jira_key = 'PS-3' WHERE title = 'Leaf'");
    // Children are Done, so they are absent from the default (non-completed) list
    sqlite.exec(
      "INSERT INTO tasks (title, status, created_at, updated_at, jira_key, parent_key) VALUES ('Sub', 'Done', '2026-01-01', '2026-01-01', 'PS-2', 'PS-1')"
    );
    sqlite.exec(
      "INSERT INTO tasks (title, status, created_at, updated_at, jira_key, epic_key) VALUES ('Child', 'Done', '2026-01-01', '2026-01-01', 'PS-4', 'PS-9')"
    );

    const res = await request("GET", "/api/v1/tasks");
    const data = await res.json();
    const byKey = new Map(data.items.map((t: { jiraKey: string; hasChildren: boolean }) => [t.jiraKey, t.hasChildren]));
    expect(byKey.get("PS-1")).toBe(true);
    expect(byKey.get("PS-9")).toBe(true);
    expect(byKey.get("PS-3")).toBe(false);
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
    expect(data.status).toBe("To Do");
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
      status: "In Progress",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Updated");
    expect(data.status).toBe("In Progress");
  });

  it("patches a task", async () => {
    const createRes = await request("POST", "/api/v1/tasks", {
      title: "Original",
    });
    const created = await createRes.json();

    const res = await request("PATCH", `/api/v1/tasks/${created.id}`, {
      status: "Done",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Original");
    expect(data.status).toBe("Done");
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

describe("Task repository changes", () => {
  beforeEach(() => {
    sqlite.exec(
      `INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1), (2, 'hb', 'front-monorepo', 1)`
    );
  });

  it("moves a task with no PR to another repository", async () => {
    const created = await (await request("POST", "/api/v1/tasks", { title: "No PR yet" })).json();
    await request("PATCH", `/api/v1/tasks/${created.id}`, { repositoryId: 1 });

    const res = await request("PATCH", `/api/v1/tasks/${created.id}`, { repositoryId: 2 });
    expect(res.status).toBe(200);
    expect((await res.json()).repositoryId).toBe(2);
  });

  it("clears the repository of a task with no PR", async () => {
    const created = await (await request("POST", "/api/v1/tasks", { title: "No PR yet" })).json();
    await request("PATCH", `/api/v1/tasks/${created.id}`, { repositoryId: 1 });

    const res = await request("PATCH", `/api/v1/tasks/${created.id}`, { repositoryId: null });
    expect(res.status).toBe(200);
    expect((await res.json()).repositoryId).toBe(null);
  });

  it("rejects a repository change once the task has a PR", async () => {
    const created = await (await request("POST", "/api/v1/tasks", { title: "Has a PR" })).json();
    sqlite.exec(`UPDATE tasks SET repository_id = 1, pr_number = 42 WHERE id = ${created.id}`);

    const res = await request("PATCH", `/api/v1/tasks/${created.id}`, { repositoryId: 2 });
    expect(res.status).toBe(400);

    const task = await (await request("GET", `/api/v1/tasks/${created.id}`)).json();
    expect(task.repositoryId).toBe(1);
  });

  it("rejects an unknown repository", async () => {
    const created = await (await request("POST", "/api/v1/tasks", { title: "No PR yet" })).json();

    const res = await request("PATCH", `/api/v1/tasks/${created.id}`, { repositoryId: 999 });
    expect(res.status).toBe(400);
  });
});

describe("Task search filter", () => {
  beforeEach(async () => {
    await request("POST", "/api/v1/tasks", { title: "Migrate to tiptap editor" });
    await request("POST", "/api/v1/tasks", { title: "Fix login bug" });
  });

  it("matches tasks containing the search term", async () => {
    const res = await request("GET", "/api/v1/tasks?title=tiptap");
    const data = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("Migrate to tiptap editor");
  });

  it("excludes tasks containing the term when prefixed with ~", async () => {
    const res = await request("GET", "/api/v1/tasks?title=~tiptap");
    const data = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("Fix login bug");
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
