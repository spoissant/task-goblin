import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { routeClient } from "../../test/request";
import { goalRoutes } from "./goals";
import { taskRoutes } from "./tasks";

const request = routeClient({ ...goalRoutes, ...taskRoutes });

beforeAll(() => createTestTables(sqlite));

beforeEach(() => {
  sqlite.run("DELETE FROM tasks");
  sqlite.run("DELETE FROM goals");
  sqlite.run("DELETE FROM status_categories");
  // One done category, so progress has something to count
  sqlite.run(
    "INSERT INTO status_categories (name, color, done, display_order, jira_mappings) VALUES ('Done', 'bg-green-700', 1, 1, '[\"Done\"]')",
  );
});

async function createGoal(name: string, context?: string) {
  const res = await request("POST", "/api/v1/goals", { name, context });
  expect(res.status).toBe(201);
  return res.json();
}

async function createTask(title: string, goalId?: number) {
  const res = await request("POST", "/api/v1/tasks", { title });
  const task = await res.json();
  if (goalId !== undefined) await request("PATCH", `/api/v1/tasks/${task.id}`, { goalId });
  return task;
}

describe("Goal endpoints", () => {
  it("creates goals in order, trimmed, with an optional context", async () => {
    const a = await createGoal("  Editor rewrite ");
    const b = await createGoal("Mobile", "  Use the design system  ");
    expect(a).toMatchObject({ name: "Editor rewrite", context: null, displayOrder: 0, archived: 0 });
    expect(b).toMatchObject({ name: "Mobile", context: "Use the design system", displayOrder: 1 });
  });

  it("requires a name", async () => {
    expect((await request("POST", "/api/v1/goals", { name: "  " })).status).toBe(400);
  });

  it("lists active goals with progress, archived ones apart", async () => {
    const goal = await createGoal("Editor");
    const archived = await createGoal("Old");
    await request("PATCH", `/api/v1/goals/${archived.id}`, { archived: true });
    await createTask("Open task", goal.id);
    const done = await createTask("Done task", goal.id);
    sqlite.run(`UPDATE tasks SET status = 'Done', jira_key = 'PS-1' WHERE id = ${done.id}`);
    await createTask("Unassigned");

    const active = await (await request("GET", "/api/v1/goals")).json();
    expect(active.items).toHaveLength(1);
    expect(active.items[0]).toMatchObject({ id: goal.id, taskCount: 2, doneCount: 1 });

    const hidden = await (await request("GET", "/api/v1/goals?archived=true")).json();
    expect(hidden.items.map((g: { id: number }) => g.id)).toEqual([archived.id]);
  });

  it("updates name, context and archived; rejects a blank name", async () => {
    const goal = await createGoal("Editor");
    const res = await request("PATCH", `/api/v1/goals/${goal.id}`, { name: " Editor v2 ", context: "brief", archived: true });
    expect(await res.json()).toMatchObject({ name: "Editor v2", context: "brief", archived: 1 });
    expect((await request("PATCH", `/api/v1/goals/${goal.id}`, { name: "" })).status).toBe(400);
    expect((await request("PATCH", "/api/v1/goals/999", { name: "x" })).status).toBe(404);
  });

  it("reorders sections", async () => {
    const a = await createGoal("A");
    const b = await createGoal("B");
    expect((await request("PUT", "/api/v1/goals/order", { ids: [b.id, a.id] })).status).toBe(204);
    const list = await (await request("GET", "/api/v1/goals")).json();
    expect(list.items.map((g: { id: number }) => g.id)).toEqual([b.id, a.id]);
    expect((await request("PUT", "/api/v1/goals/order", { ids: ["x"] })).status).toBe(400);
  });

  it("deleting a goal unassigns its tasks", async () => {
    const goal = await createGoal("Editor");
    const task = await createTask("Task", goal.id);
    expect((await request("GET", `/api/v1/tasks/${task.id}`).then((r) => r.json())).goal).toMatchObject({ id: goal.id });
    expect((await request("DELETE", `/api/v1/goals/${goal.id}`)).status).toBe(204);
    expect((await request("DELETE", `/api/v1/goals/${goal.id}`)).status).toBe(404);
    const after = await (await request("GET", `/api/v1/tasks/${task.id}`)).json();
    expect(after.goalId).toBeNull();
    expect(after.goal).toBeNull();
  });

  it("assigns tasks to a goal and rejects unknown goals", async () => {
    const goal = await createGoal("Editor");
    const task = await createTask("Task");
    const res = await request("PATCH", `/api/v1/tasks/${task.id}`, { goalId: goal.id });
    expect((await res.json()).goalId).toBe(goal.id);
    expect((await request("PATCH", `/api/v1/tasks/${task.id}`, { goalId: 999 })).status).toBe(400);
    const cleared = await request("PATCH", `/api/v1/tasks/${task.id}`, { goalId: null });
    expect((await cleared.json()).goalId).toBeNull();
  });

  it("filters task lists by goal, or by none", async () => {
    const goal = await createGoal("Editor");
    const inGoal = await createTask("In goal", goal.id);
    const loose = await createTask("Loose");
    const done = await createTask("Done in goal", goal.id);
    sqlite.run(`UPDATE tasks SET status = 'Done', jira_key = 'PS-1' WHERE id = ${done.id}`);

    const ids = async (path: string) => (await (await request("GET", path)).json()).items.map((t: { id: number }) => t.id);
    expect(await ids(`/api/v1/tasks?goalId=${goal.id}`)).toEqual([inGoal.id]);
    expect(await ids("/api/v1/tasks?goalId=none")).toEqual([loose.id]);
    expect(await ids(`/api/v1/tasks/completed?goalId=${goal.id}&showDone=true`)).toEqual([done.id]);
    expect((await request("GET", "/api/v1/tasks?goalId=abc")).status).toBe(400);
  });
});
