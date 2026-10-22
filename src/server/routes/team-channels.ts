import { eq } from "drizzle-orm";
import { db } from "../../db";
import { teamChannels } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import type { Routes } from "../router";

// Both columns are required text: trimmed, and blank or non-string is rejected.
function requiredText(body: Record<string, unknown>, key: "githubTeamSlug" | "slackChannel"): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${key} is required`);
  return value.trim();
}

export const teamChannelRoutes: Routes = {
  "/api/v1/team-channels": {
    async GET() {
      const items = await db.select().from(teamChannels).orderBy(teamChannels.githubTeamSlug);
      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      const result = await db
        .insert(teamChannels)
        .values({
          githubTeamSlug: requiredText(body, "githubTeamSlug"),
          slackChannel: requiredText(body, "slackChannel"),
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/team-channels/:id": {
    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db.select().from(teamChannels).where(eq(teamChannels.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("TeamChannel", id);
      }

      const updates: Partial<typeof teamChannels.$inferInsert> = {};
      if (body.githubTeamSlug !== undefined) updates.githubTeamSlug = requiredText(body, "githubTeamSlug");
      if (body.slackChannel !== undefined) updates.slackChannel = requiredText(body, "slackChannel");

      if (Object.keys(updates).length === 0) {
        return json(existing[0]);
      }

      const result = await db
        .update(teamChannels)
        .set(updates)
        .where(eq(teamChannels.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(_req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(teamChannels).where(eq(teamChannels.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("TeamChannel", id);
      }

      await db.delete(teamChannels).where(eq(teamChannels.id, id));
      return noContent();
    },
  },
};
