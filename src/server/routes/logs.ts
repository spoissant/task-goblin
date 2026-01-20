import { eq, sql, isNull, desc } from "drizzle-orm";
import { db } from "../../db";
import { logs, tasks, repositories } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const logRoutes: Routes = {
  "/api/v1/logs": {
    async GET(req) {
      const url = new URL(req.url);
      const includeRead = url.searchParams.get("includeRead") === "true";
      const limit = parseInt(url.searchParams.get("limit") || "25", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      // Build where condition
      const whereCondition = includeRead ? undefined : isNull(logs.readAt);

      // Query logs with left join on tasks and repositories
      const rawItems = await db
        .select({
          log: logs,
          task: {
            id: tasks.id,
            jiraKey: tasks.jiraKey,
            prNumber: tasks.prNumber,
            title: tasks.title,
            repositoryId: tasks.repositoryId,
          },
          repository: {
            owner: repositories.owner,
            repo: repositories.repo,
          },
        })
        .from(logs)
        .leftJoin(tasks, eq(logs.taskId, tasks.id))
        .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
        .where(whereCondition)
        .orderBy(desc(logs.createdAt))
        .limit(limit)
        .offset(offset);

      // Transform to include nested task object
      const items = rawItems.map((row) => ({
        ...row.log,
        task: row.task?.id
          ? {
              id: row.task.id,
              jiraKey: row.task.jiraKey,
              prNumber: row.task.prNumber,
              title: row.task.title,
              repository:
                row.task.repositoryId && row.repository?.owner
                  ? { owner: row.repository.owner, repo: row.repository.repo }
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
      const id = parseInt(params.id, 10);
      const result = await db.select().from(logs).where(eq(logs.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Log", id);
      }

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseInt(params.id, 10);

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
      const id = parseInt(params.id, 10);

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
};
