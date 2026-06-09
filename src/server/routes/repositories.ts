import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks, worktrees } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError, AppError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import type { Routes } from "../router";

// Coerce a required-reviews input to a positive integer, defaulting to 2 when absent/invalid.
function normalizeRequiredReviews(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

export const repositoryRoutes: Routes = {
  "/api/v1/repositories": {
    async GET() {
      const repos = await db.select().from(repositories);
      const allWorktrees = await db.select().from(worktrees);

      const worktreesByRepo = new Map<number, typeof allWorktrees>();
      for (const wt of allWorktrees) {
        const list = worktreesByRepo.get(wt.repositoryId) || [];
        list.push(wt);
        worktreesByRepo.set(wt.repositoryId, list);
      }

      const items = repos.map((repo) => ({
        ...repo,
        worktrees: worktreesByRepo.get(repo.id) || [],
      }));

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

      // Convert deploymentUrls object to JSON string (null if empty)
      let deploymentUrls: string | null = null;
      if (body.deploymentUrls && typeof body.deploymentUrls === "object" && Object.keys(body.deploymentUrls).length > 0) {
        deploymentUrls = JSON.stringify(body.deploymentUrls);
      }

      const result = await db
        .insert(repositories)
        .values({
          owner: body.owner,
          repo: body.repo,
          alias: typeof body.alias === "string" && body.alias.trim() ? body.alias.trim() : null,
          enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
          badgeColor: body.badgeColor ?? null,
          deploymentBranches,
          deploymentUrls,
          requiredReviews: normalizeRequiredReviews(body.requiredReviews),
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

      // Convert deploymentUrls object to JSON string (null if empty)
      let deploymentUrls: string | null = existing[0].deploymentUrls;
      if (body.deploymentUrls !== undefined) {
        deploymentUrls = body.deploymentUrls && typeof body.deploymentUrls === "object" && Object.keys(body.deploymentUrls).length > 0
          ? JSON.stringify(body.deploymentUrls)
          : null;
      }

      const result = await db
        .update(repositories)
        .set({
          owner: body.owner,
          repo: body.repo,
          alias: body.alias !== undefined
            ? (typeof body.alias === "string" && body.alias.trim() ? body.alias.trim() : null)
            : existing[0].alias,
          enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing[0].enabled,
          badgeColor: body.badgeColor !== undefined ? body.badgeColor : existing[0].badgeColor,
          deploymentBranches,
          deploymentUrls,
          requiredReviews: body.requiredReviews !== undefined
            ? normalizeRequiredReviews(body.requiredReviews)
            : existing[0].requiredReviews,
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
      if (body.alias !== undefined) {
        updates.alias = typeof body.alias === "string" && body.alias.trim() ? body.alias.trim() : null;
      }
      if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
      if (body.requiredReviews !== undefined) updates.requiredReviews = normalizeRequiredReviews(body.requiredReviews);
      if (body.badgeColor !== undefined) updates.badgeColor = body.badgeColor;
      if (body.slackChannel !== undefined) updates.slackChannel = body.slackChannel || null;
      if (body.deploymentBranches !== undefined) {
        updates.deploymentBranches = Array.isArray(body.deploymentBranches) && body.deploymentBranches.length > 0
          ? JSON.stringify(body.deploymentBranches)
          : null;
      }
      if (body.deploymentUrls !== undefined) {
        updates.deploymentUrls = body.deploymentUrls && typeof body.deploymentUrls === "object" && Object.keys(body.deploymentUrls).length > 0
          ? JSON.stringify(body.deploymentUrls)
          : null;
      }
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
