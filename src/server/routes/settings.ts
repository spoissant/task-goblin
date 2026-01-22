import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import {
  getStatusCategories,
  getTaskFilters,
  getDefaultStatusColor,
  getStatusSettings,
  saveStatusCategories,
  saveTaskFilters,
  saveDefaultColor,
  type StatusCategory,
  type TaskFilter,
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
    async GET(_req, params) {
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

    async DELETE(_req, params) {
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
      const jiraKeys = ["jira_host", "jira_email", "jira_project", "jira_jql", "jira_sprint_field"];
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

      const validKeys = ["jira_host", "jira_email", "jira_project", "jira_jql", "jira_sprint_field"];
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

  // ============================================
  // NEW Status Settings Endpoints
  // ============================================

  // Combined status settings (categories + filters + defaultColor)
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

  // Task Filters
  "/api/v1/settings/task-filters": {
    async GET() {
      const filters = await getTaskFilters();
      return json({ items: filters });
    },

    async PUT(req) {
      const body = await getBody(req);

      if (!body.filters || !Array.isArray(body.filters)) {
        throw new ValidationError("filters array is required");
      }

      // Validate each filter
      const names = new Set<string>();
      for (let i = 0; i < body.filters.length; i++) {
        const filter = body.filters[i];
        if (typeof filter.name !== "string" || !filter.name.trim()) {
          throw new ValidationError(`Filter ${i}: name is required`);
        }
        if (names.has(filter.name.toLowerCase())) {
          throw new ValidationError(`Filter ${i}: duplicate name "${filter.name}"`);
        }
        names.add(filter.name.toLowerCase());
        if (typeof filter.position !== "number") {
          throw new ValidationError(`Filter ${i}: position must be a number`);
        }
        if (!Array.isArray(filter.jiraMappings)) {
          throw new ValidationError(`Filter ${i}: jiraMappings must be an array`);
        }
        for (const mapping of filter.jiraMappings) {
          if (typeof mapping !== "string") {
            throw new ValidationError(`Filter ${i}: jiraMappings must contain only strings`);
          }
        }
      }

      const filters: Omit<TaskFilter, "id">[] = body.filters.map((f: TaskFilter) => ({
        name: f.name.trim(),
        position: f.position,
        jiraMappings: f.jiraMappings,
      }));

      await saveTaskFilters(filters);

      const updated = await getTaskFilters();
      return json({ items: updated });
    },
  },

  // Default Color
  "/api/v1/settings/status-default-color": {
    async GET() {
      const color = await getDefaultStatusColor();
      return json({ defaultColor: color });
    },

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

  // ============================================
  // Legacy Status Configuration endpoints (for backwards compatibility)
  // ============================================

  "/api/v1/settings/statuses": {
    async GET() {
      // Return in legacy format
      const settings = await getStatusSettings();
      // Convert to old format
      const statuses = settings.categories.map((cat, index) => ({
        name: cat.name,
        color: cat.color,
        order: settings.categories.length - cat.displayOrder,
        isCompleted: cat.done,
        isDefault: index === 0,
        filter: null, // Legacy format doesn't have filter at category level
        jiraMapping: cat.jiraMappings,
      }));
      return json({ statuses, defaultColor: settings.defaultColor });
    },

    async PUT(req) {
      const body = await getBody(req);

      if (!body.statuses || !Array.isArray(body.statuses)) {
        throw new ValidationError("statuses array is required");
      }

      // Convert from legacy format to new categories
      const categories: Omit<StatusCategory, "id">[] = body.statuses.map((s: {
        name: string;
        color: string | null;
        order: number;
        isCompleted: boolean;
        jiraMapping?: string[];
      }, index: number) => ({
        name: s.name,
        color: s.color || "bg-slate-500",
        done: s.isCompleted,
        displayOrder: body.statuses.length - index - 1,
        jiraMappings: s.jiraMapping || [],
      }));

      await saveStatusCategories(categories);

      // Update default color if provided
      if (body.defaultColor) {
        await saveDefaultColor(body.defaultColor);
      }

      // Return in legacy format
      const settings = await getStatusSettings();
      const statuses = settings.categories.map((cat, index) => ({
        name: cat.name,
        color: cat.color,
        order: settings.categories.length - cat.displayOrder,
        isCompleted: cat.done,
        isDefault: index === 0,
        filter: null,
        jiraMapping: cat.jiraMappings,
      }));
      return json({ statuses, defaultColor: settings.defaultColor });
    },
  },

  "/api/v1/settings/statuses/selectable": {
    async GET() {
      const categories = await getStatusCategories();
      // Return categories formatted as selectable statuses
      const items = categories.map((cat, index) => ({
        name: cat.name,
        color: cat.color,
        order: categories.length - cat.displayOrder,
        isCompleted: cat.done,
        isDefault: index === 0,
        filter: null,
        jiraMapping: cat.jiraMappings,
      }));
      return json({ items });
    },
  },
};
