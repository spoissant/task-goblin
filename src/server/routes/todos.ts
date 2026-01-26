import { eq, and, isNull, isNotNull, sql, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import { todos, tasks } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import type { Routes } from "../router";

export const todoRoutes: Routes = {
  "/api/v1/todos": {
    async GET(req) {
      const url = new URL(req.url);
      const taskId = url.searchParams.get("taskId");
      const done = url.searchParams.get("done");

      const conditions = [];
      if (taskId) {
        conditions.push(eq(todos.taskId, parseId(taskId, "taskId")));
      }
      if (done === "true") {
        conditions.push(isNotNull(todos.done));
      } else if (done === "false") {
        conditions.push(isNull(todos.done));
      }

      // Join with tasks to get task info
      let query = db
        .select({
          id: todos.id,
          content: todos.content,
          done: todos.done,
          taskId: todos.taskId,
          position: todos.position,
          createdAt: todos.createdAt,
          updatedAt: todos.updatedAt,
          task: {
            jiraKey: tasks.jiraKey,
            title: tasks.title,
          },
        })
        .from(todos)
        .leftJoin(tasks, eq(todos.taskId, tasks.id));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      // Order by position (nulls last for legacy data)
      query = query.orderBy(sql`COALESCE(${todos.position}, 999999)`) as typeof query;

      const items = await query;

      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.content || typeof body.content !== "string") {
        throw new ValidationError("content is required");
      }

      const placement = body.placement === "start" ? "start" : "end";
      const timestamp = now();
      let newPosition: number;

      if (placement === "start") {
        // Shift ALL todos with non-null positions +1
        await db
          .update(todos)
          .set({
            position: sql`${todos.position} + 1`,
            updatedAt: timestamp,
          })
          .where(isNotNull(todos.position));

        newPosition = 1;
      } else {
        // Append: position = MAX(position) + 1
        const maxPosResult = await db
          .select({ maxPos: sql<number>`COALESCE(MAX(${todos.position}), 0)` })
          .from(todos);
        newPosition = (maxPosResult[0]?.maxPos ?? 0) + 1;
      }

      const result = await db
        .insert(todos)
        .values({
          content: body.content,
          done: body.done || null,
          taskId: body.taskId || null,
          position: newPosition,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/todos/:id": {
    async GET(_req, params) {
      const id = parseId(params.id);
      const result = await db.select().from(todos).where(eq(todos.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      return json(result[0]);
    },

    async PUT(req, params) {
      const id = parseId(params.id);
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
          updatedAt: now(),
        })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      // Use 'in' operator to allow explicitly setting fields to null
      if ("content" in body) updates.content = body.content;
      if ("done" in body) updates.done = body.done;
      if ("taskId" in body) updates.taskId = body.taskId;

      const result = await db
        .update(todos)
        .set(updates)
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(_req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      await db.delete(todos).where(eq(todos.id, id));

      return noContent();
    },
  },

  "/api/v1/todos/:id/toggle": {
    async POST(_req, params) {
      const id = parseId(params.id);

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

  "/api/v1/todos/:id/skip": {
    async POST(_req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const todo = existing[0];
      const oldPosition = todo.position ?? 0;
      const timestamp = now();

      // Find max position among undone todos
      const maxPosResult = await db
        .select({ maxPos: sql<number>`COALESCE(MAX(${todos.position}), 0)` })
        .from(todos)
        .where(isNull(todos.done));
      const maxUndonePosition = maxPosResult[0]?.maxPos ?? 0;

      // If already at the end of undone todos, nothing to do
      if (oldPosition >= maxUndonePosition) {
        return json(todo);
      }

      // Shift todos between old position and max undone position up by 1
      await db
        .update(todos)
        .set({
          position: sql`${todos.position} - 1`,
          updatedAt: timestamp,
        })
        .where(
          and(
            gt(todos.position, oldPosition),
            lte(todos.position, maxUndonePosition)
          )
        );

      // Move skipped todo to end of undone list
      const result = await db
        .update(todos)
        .set({ position: maxUndonePosition, updatedAt: timestamp })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },
  },

  "/api/v1/todos/:id/promote": {
    async POST(_req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const todo = existing[0];

      // No-op if already position 1
      if (todo.position === 1) {
        return json(todo);
      }

      const timestamp = now();

      // Shift ALL todos with non-null positions +1
      await db
        .update(todos)
        .set({
          position: sql`${todos.position} + 1`,
          updatedAt: timestamp,
        })
        .where(isNotNull(todos.position));

      // Set promoted todo position = 1
      const result = await db
        .update(todos)
        .set({ position: 1, updatedAt: timestamp })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },
  },

  "/api/v1/todos/:id/reorder": {
    async PUT(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      if (typeof body.position !== "number" || body.position < 1) {
        throw new ValidationError("position must be a positive number");
      }

      const existing = await db.select().from(todos).where(eq(todos.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Todo", id);
      }

      const todo = existing[0];
      const oldPosition = todo.position ?? 0;
      const newPosition = body.position;

      if (oldPosition === newPosition) {
        return json(todo);
      }

      const timestamp = now();

      // Shift other positions to make room
      if (newPosition < oldPosition) {
        // Moving up: shift items in [newPosition, oldPosition) down by 1
        await db
          .update(todos)
          .set({
            position: sql`${todos.position} + 1`,
            updatedAt: timestamp,
          })
          .where(
            and(
              gte(todos.position, newPosition),
              lt(todos.position, oldPosition)
            )
          );
      } else {
        // Moving down: shift items in (oldPosition, newPosition] up by 1
        await db
          .update(todos)
          .set({
            position: sql`${todos.position} - 1`,
            updatedAt: timestamp,
          })
          .where(
            and(
              gt(todos.position, oldPosition),
              lte(todos.position, newPosition)
            )
          );
      }

      // Update the todo's position
      const result = await db
        .update(todos)
        .set({ position: newPosition, updatedAt: timestamp })
        .where(eq(todos.id, id))
        .returning();

      return json(result[0]);
    },
  },
};
