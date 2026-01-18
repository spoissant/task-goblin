import { eq } from "drizzle-orm";
import { db } from "../../db";
import { repositories } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

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

      const result = await db
        .insert(repositories)
        .values({
          owner: body.owner,
          repo: body.repo,
          enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/repositories/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
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
      const id = parseInt(params.id, 10);
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

      const result = await db
        .update(repositories)
        .set({
          owner: body.owner,
          repo: body.repo,
          enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing[0].enabled,
        })
        .where(eq(repositories.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseInt(params.id, 10);
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
      const id = parseInt(params.id, 10);

      const existing = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Repository", id);
      }

      await db.delete(repositories).where(eq(repositories.id, id));

      return noContent();
    },
  },
};
