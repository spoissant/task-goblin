import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { json, created } from "../response";
import { ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import {
  getStatusCategories,
  getDefaultStatusColor,
  getStatusSettings,
  saveStatusCategories,
  saveDefaultColor,
  type StatusCategory,
} from "../lib/task-status";
import type { Routes } from "../router";

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
  },

  "/api/v1/settings/:key": {
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
  },

  // Jira config bundle
  "/api/v1/settings/jira/config": {
    async GET() {
      const jiraKeys = ["jira_host", "jira_email", "jira_jql", "jira_sprint_field"];
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

      const validKeys = ["jira_host", "jira_email", "jira_jql", "jira_sprint_field"];
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

  // Combined status settings (categories + defaultColor)
  "/api/v1/settings/status-settings": {
    async GET() {
      const settings = await getStatusSettings();
      return json(settings);
    },
  },

  // Status Categories
  "/api/v1/settings/status-categories": {
    async GET() {
      const categories = await getStatusCategories();
      return json({ items: categories });
    },

    async PUT(req) {
      const body = await getBody(req);

      if (!body.categories || !Array.isArray(body.categories)) {
        throw new ValidationError("categories array is required");
      }

      // Validate each category
      for (let i = 0; i < body.categories.length; i++) {
        const cat = body.categories[i];
        if (typeof cat.name !== "string" || !cat.name.trim()) {
          throw new ValidationError(`Category ${i}: name is required`);
        }
        if (typeof cat.color !== "string" || !cat.color.trim()) {
          throw new ValidationError(`Category ${i}: color is required`);
        }
        if (typeof cat.done !== "boolean") {
          throw new ValidationError(`Category ${i}: done must be a boolean`);
        }
        if (typeof cat.displayOrder !== "number") {
          throw new ValidationError(`Category ${i}: displayOrder must be a number`);
        }
        if (!Array.isArray(cat.jiraMappings)) {
          throw new ValidationError(`Category ${i}: jiraMappings must be an array`);
        }
        for (const mapping of cat.jiraMappings) {
          if (typeof mapping !== "string") {
            throw new ValidationError(`Category ${i}: jiraMappings must contain only strings`);
          }
        }
      }

      const categories: Omit<StatusCategory, "id">[] = body.categories.map((cat: StatusCategory) => ({
        name: cat.name.trim(),
        color: cat.color,
        done: cat.done,
        displayOrder: cat.displayOrder,
        jiraMappings: cat.jiraMappings,
      }));

      await saveStatusCategories(categories);

      const updated = await getStatusCategories();
      return json({ items: updated });
    },
  },

  // Default Color
  "/api/v1/settings/status-default-color": {
    async PUT(req) {
      const body = await getBody(req);

      if (typeof body.defaultColor !== "string" || !body.defaultColor.trim()) {
        throw new ValidationError("defaultColor is required");
      }

      await saveDefaultColor(body.defaultColor);

      const color = await getDefaultStatusColor();
      return json({ defaultColor: color });
    },
  },
};
