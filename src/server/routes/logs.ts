import { eq, sql, isNull, desc, and } from "drizzle-orm";
import { db } from "../../db";
import { logs, tasks } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId, validatePagination } from "../lib/validation";
import type { Routes } from "../router";

export const logRoutes: Routes = {
  "/api/v1/logs": {
    async GET(req) {
      const url = new URL(req.url);
      const includeRead = url.searchParams.get("includeRead") === "true";
      const { limit, offset } = validatePagination(
        url.searchParams.get("limit") || "25",
        url.searchParams.get("offset")
      );

      // Build where condition
      const whereCondition = includeRead ? undefined : isNull(logs.readAt);

      // Query logs with task and repository relations
      const rawItems = await db.query.logs.findMany({
        with: {
          task: {
            columns: { id: true, jiraKey: true, prNumber: true, title: true, repositoryId: true },
            with: { repository: { columns: { owner: true, repo: true } } },
          },
        },
        where: whereCondition,
        orderBy: desc(logs.createdAt),
        limit,
        offset,
      });

      // Reshape task.repository for API compatibility
      const items = rawItems.map(({ task, ...log }) => ({
        ...log,
        task: task
          ? {
              id: task.id,
              jiraKey: task.jiraKey,
              prNumber: task.prNumber,
              title: task.title,
              repository:
                task.repositoryId && task.repository
                  ? { owner: task.repository.owner, repo: task.repository.repo }
                  : null,
            }
          : null,
      }));

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(logs)
        .where(whereCondition);
      const total = countResult[0]?.count ?? 0;

      return json({ items, total, limit, offset });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.content || typeof body.content !== "string") {
        throw new ValidationError("content is required");
      }

      if (!body.source || typeof body.source !== "string") {
        throw new ValidationError("source is required");
      }

      const result = await db
        .insert(logs)
        .values({
          taskId: body.taskId ?? null,
          content: body.content,
          source: body.source,
          createdAt: now(),
          readAt: null,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/logs/unread-count": {
    async GET() {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(logs)
        .where(isNull(logs.readAt));

      return json({ count: result[0]?.count ?? 0 });
    },
  },

  "/api/v1/logs/mark-all-read": {
    async POST() {
      await db
        .update(logs)
        .set({ readAt: now() })
        .where(isNull(logs.readAt));

      return json({ success: true });
    },
  },

  "/api/v1/logs/:id": {
    async GET(req, params) {
      const id = parseId(params.id);
      const result = await db.select().from(logs).where(eq(logs.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Log", id);
      }

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(logs).where(eq(logs.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Log", id);
      }

      await db.delete(logs).where(eq(logs.id, id));

      return noContent();
    },
  },

  "/api/v1/logs/:id/read": {
    async POST(req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(logs).where(eq(logs.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Log", id);
      }

      const result = await db
        .update(logs)
        .set({ readAt: now() })
        .where(eq(logs.id, id))
        .returning();

      return json(result[0]);
    },
  },

  "/api/v1/tasks/:taskId/logs": {
    async GET(req, params) {
      const taskId = parseId(params.taskId, "taskId");

      // Check task exists
      const taskResult = await db.select().from(tasks).where(eq(tasks.id, taskId));
      if (taskResult.length === 0) {
        throw new NotFoundError("Task", taskId);
      }

      // Get unread logs for this task, ordered newest first
      const rawItems = await db.query.logs.findMany({
        with: {
          task: {
            columns: { id: true, jiraKey: true, prNumber: true, title: true, repositoryId: true },
            with: { repository: { columns: { owner: true, repo: true } } },
          },
        },
        where: and(eq(logs.taskId, taskId), isNull(logs.readAt)),
        orderBy: desc(logs.createdAt),
      });

      const items = rawItems.map(({ task, ...log }) => ({
        ...log,
        task: task
          ? {
              id: task.id,
              jiraKey: task.jiraKey,
              prNumber: task.prNumber,
              title: task.title,
              repository:
                task.repositoryId && task.repository
                  ? { owner: task.repository.owner, repo: task.repository.repo }
                  : null,
            }
          : null,
      }));

      return json({ items, total: items.length });
    },
  },

  "/api/v1/tasks/:taskId/logs/mark-read": {
    async POST(req, params) {
      const taskId = parseId(params.taskId, "taskId");

      // Check task exists
      const taskResult = await db.select().from(tasks).where(eq(tasks.id, taskId));
      if (taskResult.length === 0) {
        throw new NotFoundError("Task", taskId);
      }

      // Mark all unread logs for this task as read
      await db
        .update(logs)
        .set({ readAt: now() })
        .where(and(eq(logs.taskId, taskId), isNull(logs.readAt)));

      return json({ success: true });
    },
  },
};
