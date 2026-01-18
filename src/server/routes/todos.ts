import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db";
import { todos } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

const VALID_PARENT_TYPES = ["task", "branch", "jira_item", "pull_request"];

async function getBody(req: Request) {
  return req.json();
}

export const todoRoutes: Routes = {
  "/api/v1/todos": {
    async GET(req) {
      const url = new URL(req.url);
      const parentId = url.searchParams.get("parentId");
      const parentType = url.searchParams.get("parentType");
      const done = url.searchParams.get("done");

      const conditions = [];
      if (parentId) {
        conditions.push(eq(todos.parentId, parseInt(parentId, 10)));
      }
      if (parentType) {
        conditions.push(eq(todos.parentType, parentType));
      }
      if (done === "true") {
        conditions.push(isNull(todos.done).not());
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

      if (body.parentType && !VALID_PARENT_TYPES.includes(body.parentType)) {
        throw new ValidationError(
          `parentType must be one of: ${VALID_PARENT_TYPES.join(", ")}`
        );
      }

      const timestamp = now();
      const result = await db
        .insert(todos)
        .values({
          content: body.content,
          done: body.done || null,
          parentId: body.parentId || null,
          parentType: body.parentType || null,
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

      if (body.parentType && !VALID_PARENT_TYPES.includes(body.parentType)) {
        throw new ValidationError(
          `parentType must be one of: ${VALID_PARENT_TYPES.join(", ")}`
        );
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
          parentId: body.parentId ?? null,
          parentType: body.parentType ?? null,
          updatedAt: now(),
        })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (body.parentType && !VALID_PARENT_TYPES.includes(body.parentType)) {
        throw new ValidationError(
          `parentType must be one of: ${VALID_PARENT_TYPES.join(", ")}`
        );
      }

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      if (body.content !== undefined) updates.content = body.content;
      if (body.done !== undefined) updates.done = body.done;
      if (body.parentId !== undefined) updates.parentId = body.parentId;
      if (body.parentType !== undefined) updates.parentType = body.parentType;

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
