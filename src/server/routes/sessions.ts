import { json } from "../response";
import { ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { getTaskOrThrow } from "../lib/queries";
import {
  getSession,
  listLatestSessions,
  listTaskSessions,
  startChoreSession,
  stopSession,
  toApi,
} from "../services/claude-sessions";
import type { Routes } from "../router";

export const sessionRoutes: Routes = {
  // Newest session per task, for the tasks table.
  "/api/v1/sessions": {
    async GET() {
      const items = (await listLatestSessions()).map(toApi);
      return json({ items, total: items.length });
    },
  },

  "/api/v1/sessions/:id": {
    async GET(_req, params) {
      return json(toApi(await getSession(parseId(params.id))));
    },
  },

  "/api/v1/sessions/:id/stop": {
    async POST(_req, params) {
      return json(toApi(await stopSession(parseId(params.id))));
    },
  },

  "/api/v1/tasks/:id/sessions": {
    async GET(_req, params) {
      const id = parseId(params.id);
      await getTaskOrThrow(id);
      const items = (await listTaskSessions(id)).map(toApi);
      return json({ items, total: items.length });
    },

    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      if (!body.choreKey || typeof body.choreKey !== "string") {
        throw new ValidationError("choreKey is required");
      }
      const row = await startChoreSession(id, body.choreKey);
      return json(toApi(row), 202);
    },
  },
};
