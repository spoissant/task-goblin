import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import {
  getStatusConfig,
  saveStatusConfig,
  getDefaultStatusColor,
  getSelectableStatuses,
  invalidateStatusConfigCache,
  type StatusConfig,
} from "../lib/task-status";
import { getJiraClient, getJiraConfig, JiraConfigError, type JiraConfig } from "../lib/jira-client";
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

  // Status configuration endpoints
  "/api/v1/settings/statuses": {
    async GET() {
      const config = await getStatusConfig();
      const defaultColor = await getDefaultStatusColor();
      return json({ statuses: config, defaultColor });
    },

    async PUT(req) {
      const body = await getBody(req);

      if (!body.statuses || !Array.isArray(body.statuses)) {
        throw new ValidationError("statuses array is required");
      }

      // Validate each status config
      for (const status of body.statuses) {
        if (typeof status.name !== "string" || !status.name.trim()) {
          throw new ValidationError("Each status must have a name");
        }
        if (typeof status.order !== "number") {
          throw new ValidationError("Each status must have an order number");
        }
        if (typeof status.isCompleted !== "boolean") {
          throw new ValidationError("Each status must have isCompleted boolean");
        }
        if (typeof status.isSelectable !== "boolean") {
          throw new ValidationError("Each status must have isSelectable boolean");
        }
      }

      await saveStatusConfig(body.statuses as StatusConfig[]);

      // Update default color if provided
      if (body.defaultColor !== undefined) {
        const existing = await db
          .select()
          .from(settings)
          .where(eq(settings.key, "status_default_color"));

        if (existing.length > 0) {
          await db
            .update(settings)
            .set({ value: body.defaultColor })
            .where(eq(settings.key, "status_default_color"));
        } else {
          await db
            .insert(settings)
            .values({ key: "status_default_color", value: body.defaultColor });
        }
        invalidateStatusConfigCache();
      }

      const config = await getStatusConfig();
      const defaultColor = await getDefaultStatusColor();
      return json({ statuses: config, defaultColor });
    },
  },

  "/api/v1/settings/statuses/selectable": {
    async GET() {
      const statuses = await getSelectableStatuses();
      return json({ items: statuses });
    },
  },

  "/api/v1/settings/statuses/fetch": {
    async POST() {
      // Fetch statuses from Jira and merge with existing config
      let config: JiraConfig;
      try {
        config = await getJiraConfig();
      } catch (err) {
        if (err instanceof JiraConfigError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      const client = getJiraClient(config);

      try {
        // Fetch all statuses from Jira
        const jiraStatuses = await client.workflowStatuses.getStatuses();

        // Get existing config
        const existingConfig = await getStatusConfig();
        const existingMap = new Map(
          existingConfig.map((s) => [s.name.toLowerCase(), s])
        );

        // Merge: preserve user settings for known statuses, add new ones with defaults
        const mergedConfig: StatusConfig[] = [];
        const seenNames = new Set<string>();

        // First, add all existing statuses (preserving their settings)
        for (const existing of existingConfig) {
          mergedConfig.push(existing);
          seenNames.add(existing.name.toLowerCase());
        }

        // Then add new statuses from Jira with defaults
        let maxOrder = Math.max(...existingConfig.map((s) => s.order), 0);
        for (const jiraStatus of jiraStatuses) {
          const name = jiraStatus.name || "";
          if (!name || seenNames.has(name.toLowerCase())) {
            continue;
          }

          seenNames.add(name.toLowerCase());
          maxOrder++;

          // Determine if this is likely a completed status
          const lowerName = name.toLowerCase();
          const isCompleted =
            lowerName.includes("done") ||
            lowerName.includes("closed") ||
            lowerName.includes("completed") ||
            lowerName.includes("cancelled") ||
            lowerName.includes("rejected") ||
            lowerName === "ready to prod";

          mergedConfig.push({
            name,
            color: null, // Use default
            order: maxOrder,
            isCompleted,
            isSelectable: false, // New statuses are not selectable by default
          });
        }

        // Save merged config
        await saveStatusConfig(mergedConfig);

        const defaultColor = await getDefaultStatusColor();
        return json({
          statuses: mergedConfig,
          defaultColor,
          fetched: jiraStatuses.length,
          added: mergedConfig.length - existingConfig.length,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch statuses from Jira";
        throw new ValidationError(`Jira API error: ${message}`);
      }
    },
  },
};
