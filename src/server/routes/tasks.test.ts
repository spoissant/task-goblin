import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sqlite } from "../../db";
import { createRouter } from "../router";
import { routes } from "./index";
import { withErrorBoundary } from "../middleware";

let router: ReturnType<typeof createRouter>;

beforeAll(() => {
  // Create tables in the in-memory test database
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      done TEXT,
      task_id INTEGER REFERENCES tasks(id),
      branch_id INTEGER REFERENCES branches(id),
      jira_item_id INTEGER REFERENCES jira_items(id),
      pull_request_id INTEGER REFERENCES pull_requests(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      repository_id INTEGER NOT NULL REFERENCES repositories(id),
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      pull_request_id INTEGER REFERENCES pull_requests(id)
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number INTEGER NOT NULL,
      repository_id INTEGER NOT NULL REFERENCES repositories(id),
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      author TEXT,
      head_branch TEXT,
      base_branch TEXT,
      is_draft INTEGER NOT NULL DEFAULT 0,
      checks_status TEXT,
      review_status TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jira_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      type TEXT,
      assignee TEXT,
      priority TEXT,
      sprint TEXT,
      epic_key TEXT,
      last_comment TEXT,
      task_id INTEGER REFERENCES tasks(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_by (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocked_task_id INTEGER REFERENCES tasks(id),
      blocked_branch_id INTEGER REFERENCES branches(id),
      blocker_task_id INTEGER REFERENCES tasks(id),
      blocker_todo_id INTEGER REFERENCES todos(id),
      blocker_branch_id INTEGER REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  router = createRouter(routes);
});

beforeEach(() => {
  // Clear all tables before each test
  sqlite.exec("DELETE FROM blocked_by");
  sqlite.exec("DELETE FROM branches");
  sqlite.exec("DELETE FROM todos");
  sqlite.exec("DELETE FROM jira_items");
  sqlite.exec("DELETE FROM pull_requests");
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
