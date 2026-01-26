import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError, AppError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import type { Routes } from "../router";

export const repositoryRoutes: Routes = {
  "/api/v1/repositories": {
    async GET() {
      const items = await db.select().from(repositories);
      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.owner || typeof body.owner !== "string") {
        throw new ValidationError("owner is required");
      }
      if (!body.repo || typeof body.repo !== "string") {
        throw new ValidationError("repo is required");
      }

      // Convert deploymentBranches array to JSON string (null if empty)
      let deploymentBranches: string | null = null;
      if (Array.isArray(body.deploymentBranches) && body.deploymentBranches.length > 0) {
        deploymentBranches = JSON.stringify(body.deploymentBranches);
      }

      const result = await db
        .insert(repositories)
        .values({
          owner: body.owner,
          repo: body.repo,
          enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
          badgeColor: body.badgeColor ?? null,
          deploymentBranches,
          localPath: body.localPath ?? null,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/repositories/:id": {
    async GET(req, params) {
      const id = parseId(params.id);
      const result = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Repository", id);
      }

      return json(result[0]);
    },

    async PUT(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      if (!body.owner || typeof body.owner !== "string") {
        throw new ValidationError("owner is required");
      }
      if (!body.repo || typeof body.repo !== "string") {
        throw new ValidationError("repo is required");
      }

      const existing = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Repository", id);
      }

      // Convert deploymentBranches array to JSON string (null if empty)
      let deploymentBranches: string | null = existing[0].deploymentBranches;
      if (body.deploymentBranches !== undefined) {
        deploymentBranches = Array.isArray(body.deploymentBranches) && body.deploymentBranches.length > 0
          ? JSON.stringify(body.deploymentBranches)
          : null;
      }

      const result = await db
        .update(repositories)
        .set({
          owner: body.owner,
          repo: body.repo,
          enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing[0].enabled,
          badgeColor: body.badgeColor !== undefined ? body.badgeColor : existing[0].badgeColor,
          deploymentBranches,
          localPath: body.localPath !== undefined ? body.localPath : existing[0].localPath,
        })
        .where(eq(repositories.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Repository", id);
      }

      const updates: Record<string, unknown> = {};
      if (body.owner !== undefined) updates.owner = body.owner;
      if (body.repo !== undefined) updates.repo = body.repo;
      if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
      if (body.badgeColor !== undefined) updates.badgeColor = body.badgeColor;
      if (body.deploymentBranches !== undefined) {
        updates.deploymentBranches = Array.isArray(body.deploymentBranches) && body.deploymentBranches.length > 0
          ? JSON.stringify(body.deploymentBranches)
          : null;
      }
      if (body.localPath !== undefined) updates.localPath = body.localPath || null;

      if (Object.keys(updates).length === 0) {
        return json(existing[0]);
      }

      const result = await db
        .update(repositories)
        .set(updates)
        .where(eq(repositories.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Repository", id);
      }

      // Check for referential integrity - prevent deletion if tasks reference this repository
      const taskCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(eq(tasks.repositoryId, id));

      if (taskCount[0]?.count > 0) {
        throw new AppError(
          `Cannot delete repository: ${taskCount[0].count} task(s) reference it`,
          409,
          "REFERENTIAL_INTEGRITY"
        );
      }

      await db.delete(repositories).where(eq(repositories.id, id));

      return noContent();
    },
  },
};
