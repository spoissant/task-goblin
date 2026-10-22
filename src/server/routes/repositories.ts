import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError, AppError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import type { Routes } from "../router";

type RepositoryFields = Partial<typeof repositories.$inferInsert>;

// Optional text columns (localPath may start with ~): trimmed, and null or "" clears them.
const TEXT_FIELDS = ["alias", "localPath", "badgeColor", "slackChannel", "setupCommand", "teardownCommand", "defaultBaseBranch"] as const;

/** The columns a POST or PATCH body sets, normalized; fields the body leaves out stay unset. */
function repositoryFields(body: Record<string, unknown>): RepositoryFields {
  const fields: RepositoryFields = {};
  for (const key of ["owner", "repo"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${key} is required`);
    fields[key] = value.trim();
  }
  for (const key of TEXT_FIELDS) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") throw new ValidationError(`${key} must be a string or null`);
    fields[key] = value?.trim() || null;
  }
  if (body.enabled !== undefined) fields.enabled = body.enabled ? 1 : 0;
  if (body.deploymentBranches !== undefined) {
    const branches = body.deploymentBranches;
    fields.deploymentBranches = Array.isArray(branches) && branches.length > 0 ? JSON.stringify(branches) : null;
  }
  if (body.deploymentUrls !== undefined) {
    const urls = body.deploymentUrls;
    fields.deploymentUrls = urls && typeof urls === "object" && Object.keys(urls).length > 0 ? JSON.stringify(urls) : null;
  }
  return fields;
}

export const repositoryRoutes: Routes = {
  "/api/v1/repositories": {
    async GET() {
      const items = await db.select().from(repositories);
      return json({ items, total: items.length });
    },

    async POST(req) {
      const fields = repositoryFields(await getBody(req));
      if (!fields.owner) throw new ValidationError("owner is required");
      if (!fields.repo) throw new ValidationError("repo is required");

      const result = await db
        .insert(repositories)
        .values({ ...fields, owner: fields.owner, repo: fields.repo })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/repositories/:id": {
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

      const updates = repositoryFields(body);
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

    async DELETE(_req, params) {
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
