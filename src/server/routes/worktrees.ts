import { eq } from "drizzle-orm";
import { db } from "../../db";
import { worktrees, repositories } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

export const worktreeRoutes: Routes = {
  "/api/v1/repositories/:repositoryId/worktrees": {
    async GET(req, params) {
      const repositoryId = parseId(params.repositoryId, "repositoryId");

      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repositoryId));
      if (repo.length === 0) {
        throw new NotFoundError("Repository", repositoryId);
      }

      const items = await db
        .select()
        .from(worktrees)
        .where(eq(worktrees.repositoryId, repositoryId));

      return json({ items, total: items.length });
    },

    async POST(req, params) {
      const repositoryId = parseId(params.repositoryId, "repositoryId");
      const body = await getBody(req);

      if (!body.path || typeof body.path !== "string") {
        throw new ValidationError("path is required");
      }

      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repositoryId));
      if (repo.length === 0) {
        throw new NotFoundError("Repository", repositoryId);
      }

      const timestamp = now();
      const result = await db
        .insert(worktrees)
        .values({
          repositoryId,
          path: body.path,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/worktrees/:id": {
    async DELETE(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(worktrees)
        .where(eq(worktrees.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Worktree", id);
      }

      await db.delete(worktrees).where(eq(worktrees.id, id));
      return noContent();
    },
  },
};
