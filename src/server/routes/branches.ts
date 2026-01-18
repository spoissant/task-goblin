import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { branches, repositories, pullRequests } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const branchRoutes: Routes = {
  "/api/v1/branches": {
    async GET(req) {
      const url = new URL(req.url);
      const taskId = url.searchParams.get("taskId");
      const repositoryId = url.searchParams.get("repositoryId");

      const conditions = [];
      if (taskId) {
        conditions.push(eq(branches.taskId, parseInt(taskId, 10)));
      }
      if (repositoryId) {
        conditions.push(eq(branches.repositoryId, parseInt(repositoryId, 10)));
      }

      const items =
        conditions.length > 0
          ? await db
              .select()
              .from(branches)
              .where(and(...conditions))
          : await db.select().from(branches);

      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.name || typeof body.name !== "string") {
        throw new ValidationError("name is required");
      }
      if (!body.repositoryId || typeof body.repositoryId !== "number") {
        throw new ValidationError("repositoryId is required and must be a number");
      }
      if (!body.taskId || typeof body.taskId !== "number") {
        throw new ValidationError("taskId is required and must be a number");
      }

      // Verify repository exists
      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, body.repositoryId));
      if (repo.length === 0) {
        throw new ValidationError(`Repository with id ${body.repositoryId} not found`);
      }

      const result = await db
        .insert(branches)
        .values({
          name: body.name,
          repositoryId: body.repositoryId,
          taskId: body.taskId,
          pullRequestId: body.pullRequestId || null,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/branches/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db.select().from(branches).where(eq(branches.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Branch", id);
      }

      const branch = result[0];

      // Get related entities
      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, branch.repositoryId));

      let pr = null;
      if (branch.pullRequestId) {
        const prResult = await db
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.id, branch.pullRequestId));
        pr = prResult[0] || null;
      }

      return json({
        ...branch,
        repository: repo[0] || null,
        pullRequest: pr,
      });
    },

    async PUT(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.name || typeof body.name !== "string") {
        throw new ValidationError("name is required");
      }
      if (!body.repositoryId || typeof body.repositoryId !== "number") {
        throw new ValidationError("repositoryId is required and must be a number");
      }
      if (!body.taskId || typeof body.taskId !== "number") {
        throw new ValidationError("taskId is required and must be a number");
      }

      const existing = await db.select().from(branches).where(eq(branches.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Branch", id);
      }

      const result = await db
        .update(branches)
        .set({
          name: body.name,
          repositoryId: body.repositoryId,
          taskId: body.taskId,
          pullRequestId: body.pullRequestId ?? null,
        })
        .where(eq(branches.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      const existing = await db.select().from(branches).where(eq(branches.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Branch", id);
      }

      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.repositoryId !== undefined) updates.repositoryId = body.repositoryId;
      if (body.taskId !== undefined) updates.taskId = body.taskId;
      if (body.pullRequestId !== undefined) updates.pullRequestId = body.pullRequestId;

      if (Object.keys(updates).length === 0) {
        return json(existing[0]);
      }

      const result = await db
        .update(branches)
        .set(updates)
        .where(eq(branches.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(branches).where(eq(branches.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Branch", id);
      }

      await db.delete(branches).where(eq(branches.id, id));

      return noContent();
    },
  },
};
