import { json } from "../response";
import { ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { getAllSettings, getSetting, setSetting } from "../lib/settings";
import {
  getStatusCategories,
  getDefaultStatusColor,
  getStatusSettings,
  saveStatusCategories,
  saveDefaultColor,
} from "../lib/task-status";
import { setAutoSyncEnabled } from "../services/sync-scheduler";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import type { StatusCategory } from "@/shared/types";
import type { Routes } from "../router";

const JIRA_CONFIG_KEYS = ["jira_host", "jira_email", "jira_jql", "jira_sprint_field"] as const;

// A setting's new value from the body: text, or null (or missing) to clear it.
function settingValue(body: Record<string, unknown>, field: string): string | null {
  const value = body[field] ?? null;
  if (value !== null && typeof value !== "string") {
    throw new ValidationError(`${field} must be a string or null`);
  }
  return value;
}

async function getJiraConfig(): Promise<Record<string, string | null>> {
  const config: Record<string, string | null> = {};
  for (const key of JIRA_CONFIG_KEYS) config[key] = await getSetting(key);
  return config;
}

export const settingsRoutes: Routes = {
  "/api/v1/settings": {
    async GET() {
      return json(await getAllSettings());
    },
  },

  "/api/v1/settings/:key": {
    async PUT(req, params) {
      const value = settingValue(await getBody(req), "value");
      await setSetting(params.key, value);
      if (params.key === AUTO_CHORES_SETTING) setAutoSyncEnabled(value !== "false");
      return json({ key: params.key, value });
    },
  },

  // Jira config bundle
  "/api/v1/settings/jira/config": {
    async GET() {
      return json(await getJiraConfig());
    },

    async PUT(req) {
      const body = await getBody(req);
      const updates = JIRA_CONFIG_KEYS.filter((key) => body[key] !== undefined).map((key) => [key, settingValue(body, key)] as const);
      for (const [key, value] of updates) await setSetting(key, value);
      return json(await getJiraConfig());
    },
  },

  // Combined status settings (categories + defaultColor)
  "/api/v1/settings/status-settings": {
    async GET() {
      return json(await getStatusSettings());
    },
  },

  // Status Categories (read them from status-settings)
  "/api/v1/settings/status-categories": {
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
