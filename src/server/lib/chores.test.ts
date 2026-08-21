import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../../db";
import { tasks, todos, statusCategories } from "../../db/schema";
import { createTestTables } from "../../test/createSchema";
import { getChores } from "./chores";

const NOW = "2026-08-21T00:00:00.000Z";

beforeAll(() => {
  createTestTables(sqlite);
});

beforeEach(() => {
  sqlite.exec("DELETE FROM todos");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM status_categories");
});

async function seedTask() {
  await db.insert(statusCategories).values([
    { name: "In Progress", color: "blue", done: 0, displayOrder: 1, jiraMappings: "[]" },
    { name: "Done", color: "green", done: 1, displayOrder: 2, jiraMappings: "[]" },
  ]);

  const [task] = await db
    .insert(tasks)
    .values({
      title: "Poll deletion",
      status: "In Progress",
      createdAt: NOW,
      updatedAt: NOW,
      prNumber: 42,
      headBranch: "feature/poll",
      baseBranch: "main",
      prState: "open",
      isDraft: 0,
      checksStatus: "passing",
      unresolvedCommentCount: 0,
    })
    .returning();

  return task;
}

async function addTodo(taskId: number, content: string) {
  const [todo] = await db
    .insert(todos)
    .values({ content, taskId, position: 1, createdAt: NOW, updatedAt: NOW })
    .returning();
  return todo;
}

describe("getChores — pending todos feed chore 4", () => {
  it("does not surface chore 4 when there are no comments and no todos", async () => {
    const task = await seedTask();

    const entries = await getChores({ taskId: task.id });

    expect(entries.find((e) => e.key === "address-pr-comments")).toBeUndefined();
  });

  it("surfaces chore 4 exactly once for a task with pending todos", async () => {
    const task = await seedTask();
    await addTodo(task.id, "Before merge: flip the Gemfile pin");
    await addTodo(task.id, "Verify the poll delete hits the backend");

    const entries = await getChores({ taskId: task.id });
    const matches = entries.filter((e) => e.key === "address-pr-comments");

    expect(matches).toHaveLength(1);
    expect(matches[0].number).toBe(4);
    expect(matches[0].prompt).toBe(`/chore-address-pr-comments ${task.id}`);
  });

  it("never emits per-todo chore entries", async () => {
    const task = await seedTask();
    await addTodo(task.id, "Some note");

    const entries = await getChores({ taskId: task.id });

    expect(entries.some((e) => e.key.startsWith("todo-"))).toBe(false);
  });

  it("drops chore 4 once the last pending todo is done", async () => {
    const task = await seedTask();
    const todo = await addTodo(task.id, "Some note");

    await db.update(todos).set({ done: NOW, updatedAt: NOW }).where(eq(todos.id, todo.id));

    const entries = await getChores({ taskId: task.id });

    expect(entries.find((e) => e.key === "address-pr-comments")).toBeUndefined();
  });

  it("still surfaces chore 4 from unresolved PR comments alone", async () => {
    const task = await seedTask();
    await db.update(tasks).set({ unresolvedCommentCount: 3 }).where(eq(tasks.id, task.id));

    const entries = await getChores({ taskId: task.id });

    expect(entries.find((e) => e.key === "address-pr-comments")?.number).toBe(4);
  });
});
