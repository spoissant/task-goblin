import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const settingsRoutes: Routes = {
  "/api/v1/settings": {
    async GET() {
      const items = await db.select().from(settings);
      // Convert to key-value object
      const result: Record<string, string | null> = {};
      for (const item of items) {
        result[item.key] = item.value;
      }
      return json(result);
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.key || typeof body.key !== "string") {
        throw new ValidationError("key is required");
      }

      // Upsert: insert or update
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, body.key));

      if (existing.length > 0) {
        const result = await db
          .update(settings)
          .set({ value: body.value ?? null })
          .where(eq(settings.key, body.key))
          .returning();
        return json(result[0]);
      }

      const result = await db
        .insert(settings)
        .values({
          key: body.key,
          value: body.value ?? null,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/settings/:key": {
    async GET(req, params) {
      const { key } = params;
      const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key));

      if (result.length === 0) {
        throw new NotFoundError("Setting", key);
      }

      return json(result[0]);
    },

    async PUT(req, params) {
      const { key } = params;
      const body = await getBody(req);

      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key));

      if (existing.length === 0) {
        // Create new
        const result = await db
          .insert(settings)
          .values({ key, value: body.value ?? null })
          .returning();
        return created(result[0]);
      }

      const result = await db
        .update(settings)
        .set({ value: body.value ?? null })
        .where(eq(settings.key, key))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const { key } = params;

      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key));
      if (existing.length === 0) {
        throw new NotFoundError("Setting", key);
      }

      await db.delete(settings).where(eq(settings.key, key));

      return noContent();
    },
  },

  // Jira config bundle
  "/api/v1/settings/jira/config": {
    async GET() {
      const jiraKeys = ["jira_host", "jira_email", "jira_project", "jira_jql"];
      const items = await db.select().from(settings);

      const config: Record<string, string | null> = {};
      for (const item of items) {
        if (jiraKeys.includes(item.key)) {
          config[item.key] = item.value;
        }
      }

      return json(config);
    },

    async PUT(req) {
      const body = await getBody(req);

      const validKeys = ["jira_host", "jira_email", "jira_project", "jira_jql"];
      const updates: { key: string; value: string | null }[] = [];

      for (const key of validKeys) {
        if (body[key] !== undefined) {
          updates.push({ key, value: body[key] });
        }
      }

      for (const { key, value } of updates) {
        const existing = await db
          .select()
          .from(settings)
          .where(eq(settings.key, key));

        if (existing.length > 0) {
          await db.update(settings).set({ value }).where(eq(settings.key, key));
        } else {
          await db.insert(settings).values({ key, value });
        }
      }

      // Return updated config
      const items = await db.select().from(settings);
      const config: Record<string, string | null> = {};
      for (const item of items) {
        if (validKeys.includes(item.key)) {
          config[item.key] = item.value;
        }
      }

      return json(config);
    },
  },
};
