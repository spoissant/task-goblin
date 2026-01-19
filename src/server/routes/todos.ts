import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { todos } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const todoRoutes: Routes = {
  "/api/v1/todos": {
    async GET(req) {
      const url = new URL(req.url);
      const taskId = url.searchParams.get("taskId");
      const branchId = url.searchParams.get("branchId");
      const jiraItemId = url.searchParams.get("jiraItemId");
      const pullRequestId = url.searchParams.get("pullRequestId");
      const done = url.searchParams.get("done");

      const conditions = [];
      if (taskId) {
        conditions.push(eq(todos.taskId, parseInt(taskId, 10)));
      }
      if (branchId) {
        conditions.push(eq(todos.branchId, parseInt(branchId, 10)));
      }
      if (jiraItemId) {
        conditions.push(eq(todos.jiraItemId, parseInt(jiraItemId, 10)));
      }
      if (pullRequestId) {
        conditions.push(eq(todos.pullRequestId, parseInt(pullRequestId, 10)));
      }
      if (done === "true") {
        conditions.push(isNotNull(todos.done));
      } else if (done === "false") {
        conditions.push(isNull(todos.done));
      }

      const items =
        conditions.length > 0
          ? await db
              .select()
              .from(todos)
              .where(and(...conditions))
          : await db.select().from(todos);

      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.content || typeof body.content !== "string") {
        throw new ValidationError("content is required");
      }

      const timestamp = now();
      const result = await db
        .insert(todos)
        .values({
          content: body.content,
          done: body.done || null,
          taskId: body.taskId || null,
          branchId: body.branchId || null,
          jiraItemId: body.jiraItemId || null,
          pullRequestId: body.pullRequestId || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/todos/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db.select().from(todos).where(eq(todos.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      return json(result[0]);
    },

    async PUT(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.content || typeof body.content !== "string") {
        throw new ValidationError("content is required");
      }

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const result = await db
        .update(todos)
        .set({
          content: body.content,
          done: body.done ?? null,
          taskId: body.taskId ?? null,
          branchId: body.branchId ?? null,
          jiraItemId: body.jiraItemId ?? null,
          pullRequestId: body.pullRequestId ?? null,
          updatedAt: now(),
        })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      if (body.content !== undefined) updates.content = body.content;
      if (body.done !== undefined) updates.done = body.done;
      if (body.taskId !== undefined) updates.taskId = body.taskId;
      if (body.branchId !== undefined) updates.branchId = body.branchId;
      if (body.jiraItemId !== undefined) updates.jiraItemId = body.jiraItemId;
      if (body.pullRequestId !== undefined) updates.pullRequestId = body.pullRequestId;

      const result = await db
        .update(todos)
        .set(updates)
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      await db.delete(todos).where(eq(todos.id, id));

      return noContent();
    },
  },

  "/api/v1/todos/:id/toggle": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const todo = existing[0];
      const newDone = todo.done ? null : now();

      const result = await db
        .update(todos)
        .set({ done: newDone, updatedAt: now() })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },
  },
};
