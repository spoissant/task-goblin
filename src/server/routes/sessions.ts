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
  startCustomSession,
  stopSession,
  toApi,
} from "../services/claude-sessions";
import { SESSION_EFFORTS, SESSION_MODELS } from "../../shared/types";
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

    // Either { choreKey } for a chore run — with an optional `prompt` standing
    // in for the chore's own command — or { prompt } alone for a hand-typed
    // prompt. Both take an optional model and effort.
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      const model = optionalEnum(body.model, SESSION_MODELS, "model");
      const effort = optionalEnum(body.effort, SESSION_EFFORTS, "effort");
      const prompt = typeof body.prompt === "string" ? body.prompt : null;
      if (typeof body.choreKey === "string" && body.choreKey) {
        const row = await startChoreSession(id, body.choreKey, { prompt, model, effort });
        return json(toApi(row), 202);
      }
      if (prompt === null) {
        throw new ValidationError("choreKey or prompt is required");
      }
      const row = await startCustomSession(id, { prompt, model, effort });
      return json(toApi(row), 202);
    },
  },
};

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
