import { eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { jiraItems, tasks } from "../../db/schema";
import { json, noContent } from "../response";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { JiraConfigError } from "../lib/jira-client";
import { syncJiraItems, syncJiraItemByKey, JiraApiError } from "../services/jira-sync";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const jiraRoutes: Routes = {
  "/api/v1/jira/items": {
    async GET(req) {
      const url = new URL(req.url);
      const linked = url.searchParams.get("linked");
      const taskId = url.searchParams.get("taskId");

      let items;
      if (linked === "true") {
        items = await db
          .select()
          .from(jiraItems)
          .where(isNotNull(jiraItems.taskId));
      } else if (linked === "false") {
        items = await db
          .select()
          .from(jiraItems)
          .where(isNull(jiraItems.taskId));
      } else if (taskId) {
        items = await db
          .select()
          .from(jiraItems)
          .where(eq(jiraItems.taskId, parseInt(taskId, 10)));
      } else {
        items = await db.select().from(jiraItems);
      }

      return json({ items, total: items.length });
    },
  },

  "/api/v1/jira/items/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db
        .select()
        .from(jiraItems)
        .where(eq(jiraItems.id, id));

      if (result.length === 0) {
        throw new NotFoundError("JiraItem", id);
      }

      const item = result[0];

      // Get linked task if any
      let task = null;
      if (item.taskId) {
        const taskResult = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, item.taskId));
        task = taskResult[0] || null;
      }

      return json({ ...item, task });
    },
  },

  "/api/v1/jira/items/key/:key": {
    async GET(req, params) {
      const { key } = params;
      const result = await db
        .select()
        .from(jiraItems)
        .where(eq(jiraItems.key, key));

      if (result.length === 0) {
        throw new NotFoundError("JiraItem", key);
      }

      const item = result[0];

      // Get linked task if any
      let task = null;
      if (item.taskId) {
        const taskResult = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, item.taskId));
        task = taskResult[0] || null;
      }

      return json({ ...item, task });
    },
  },

  "/api/v1/jira/items/:id/link": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.taskId || typeof body.taskId !== "number") {
        throw new ValidationError("taskId is required and must be a number");
      }

      const existing = await db
        .select()
        .from(jiraItems)
        .where(eq(jiraItems.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("JiraItem", id);
      }

      // Verify task exists
      const taskResult = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, body.taskId));
      if (taskResult.length === 0) {
        throw new ValidationError(`Task with id ${body.taskId} not found`);
      }

      const result = await db
        .update(jiraItems)
        .set({ taskId: body.taskId, updatedAt: now() })
        .where(eq(jiraItems.id, id))
        .returning();

      return json(result[0]);
    },
  },

  "/api/v1/jira/items/:id/unlink": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db
        .select()
        .from(jiraItems)
        .where(eq(jiraItems.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("JiraItem", id);
      }

      const result = await db
        .update(jiraItems)
        .set({ taskId: null, updatedAt: now() })
        .where(eq(jiraItems.id, id))
        .returning();

      return json(result[0]);
    },
  },

  "/api/v1/refresh/jira": {
    async POST() {
      try {
        const result = await syncJiraItems();
        return json(result);
      } catch (err) {
        if (err instanceof JiraConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof JiraApiError) {
          const statusCode = err.code === "JIRA_AUTH_FAILED" ? 401 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/refresh/jira/:key": {
    async POST(req, params) {
      const { key } = params;
      try {
        const result = await syncJiraItemByKey(key);
        return json(result);
      } catch (err) {
        if (err instanceof JiraConfigError) {
          throw new AppError(err.message, 400, err.code);
        }
        if (err instanceof JiraApiError) {
          const statusCode =
            err.code === "JIRA_AUTH_FAILED" ? 401 :
            err.code === "JIRA_ISSUE_NOT_FOUND" ? 404 : 502;
          throw new AppError(err.message, statusCode, err.code);
        }
        throw err;
      }
    },
  },
};
