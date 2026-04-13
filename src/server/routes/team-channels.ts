import { eq } from "drizzle-orm";
import { db } from "../../db";
import { teamChannels } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import type { Routes } from "../router";

export const teamChannelRoutes: Routes = {
  "/api/v1/team-channels": {
    async GET() {
      const items = await db.select().from(teamChannels).orderBy(teamChannels.githubTeamSlug);
      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.githubTeamSlug || typeof body.githubTeamSlug !== "string") {
        throw new ValidationError("githubTeamSlug is required");
      }
      if (!body.slackChannel || typeof body.slackChannel !== "string") {
        throw new ValidationError("slackChannel is required");
      }

      const result = await db
        .insert(teamChannels)
        .values({
          githubTeamSlug: body.githubTeamSlug.trim(),
          slackChannel: body.slackChannel.trim(),
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

      const updates: Record<string, unknown> = {};
      if (body.githubTeamSlug !== undefined) updates.githubTeamSlug = body.githubTeamSlug.trim();
      if (body.slackChannel !== undefined) updates.slackChannel = body.slackChannel.trim();

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

    async DELETE(req, params) {
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
