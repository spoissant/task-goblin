import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, branches, blockedBy, jiraItems } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

const VALID_STATUSES = ["todo", "in_progress", "code_review", "qa", "done", "blocked"];

async function getBody(req: Request) {
  return req.json();
}

export const taskRoutes: Routes = {
  "/api/v1/tasks": {
    async GET(req) {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      const blocked = url.searchParams.get("blocked");

      let query = db.select().from(tasks);

      const conditions = [];
      if (status) {
        conditions.push(eq(tasks.status, status));
      }
      if (blocked === "true") {
        conditions.push(
          sql`${tasks.id} IN (SELECT blocked_task_id FROM blocked_by WHERE blocked_task_id IS NOT NULL)`
        );
      } else if (blocked === "false") {
        conditions.push(
          sql`${tasks.id} NOT IN (SELECT blocked_task_id FROM blocked_by WHERE blocked_task_id IS NOT NULL)`
        );
      }

      const items =
        conditions.length > 0
          ? await db
              .select()
              .from(tasks)
              .where(and(...conditions))
          : await db.select().from(tasks);

      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      if (body.status && !VALID_STATUSES.includes(body.status)) {
        throw new ValidationError(
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const timestamp = now();
      const result = await db
        .insert(tasks)
        .values({
          title: body.title,
          description: body.description || null,
          status: body.status || "todo",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/tasks/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db.select().from(tasks).where(eq(tasks.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const task = result[0];

      // Get related entities
      const taskTodos = await db
        .select()
        .from(todos)
        .where(eq(todos.taskId, id));

      const taskBranches = await db
        .select()
        .from(branches)
        .where(eq(branches.taskId, id));

      const taskJiraItems = await db
        .select()
        .from(jiraItems)
        .where(eq(jiraItems.taskId, id));

      const taskBlockedBy = await db
        .select()
        .from(blockedBy)
        .where(eq(blockedBy.blockedTaskId, id));

      return json({
        ...task,
        todos: taskTodos,
        branches: taskBranches,
        jiraItems: taskJiraItems,
        blockedBy: taskBlockedBy,
      });
    },

    async PUT(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      if (body.status && !VALID_STATUSES.includes(body.status)) {
        throw new ValidationError(
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const result = await db
        .update(tasks)
        .set({
          title: body.title,
          description: body.description ?? null,
          status: body.status || existing[0].status,
          updatedAt: now(),
        })
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (body.status && !VALID_STATUSES.includes(body.status)) {
        throw new ValidationError(
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.status !== undefined) updates.status = body.status;

      const result = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      // Cascade delete: blockedBy, branches, todos
      await db
        .delete(blockedBy)
        .where(eq(blockedBy.blockedTaskId, id));
      await db.delete(branches).where(eq(branches.taskId, id));
      await db
        .delete(todos)
        .where(eq(todos.taskId, id));

      // Orphan jiraItems (set taskId = null)
      await db
        .update(jiraItems)
        .set({ taskId: null })
        .where(eq(jiraItems.taskId, id));

      await db.delete(tasks).where(eq(tasks.id, id));

      return noContent();
    },
  },
};
