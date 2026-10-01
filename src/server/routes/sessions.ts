import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { json } from "../response";
import { ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId, validatePagination } from "../lib/validation";
import { getTaskOrThrow } from "../lib/queries";
import {
  getSession,
  listLatestReviewSessions,
  listLatestSessions,
  listRecentSessions,
  listTaskSessions,
  respawnSession,
  startChoreSession,
  startCustomSession,
  startReviewSession,
  stopSession,
  toApi,
} from "../services/claude-sessions";
import { listSessionAnalytics } from "../services/session-usage";
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

  // Sessions across all tasks, newest first and paginated, for the sessions page.
  "/api/v1/sessions/recent": {
    async GET(req) {
      const url = new URL(req.url);
      const { limit, offset } = validatePagination(url.searchParams.get("limit"), url.searchParams.get("offset"));
      const { rows, total } = await listRecentSessions(limit, offset);
      const items = rows.map((row) => ({ ...toApi(row), taskTitle: row.taskTitle }));
      return json({ items, total, limit, offset });
    },
  },

  // Every session whose usage was collected, one row each, for the analytics page.
  "/api/v1/sessions/analytics": {
    async GET() {
      const items = await listSessionAnalytics();
      return json({ items, total: items.length });
    },
  },

  // Task-less PR reviews for the Reviews page: newest session per PR, and start one.
  "/api/v1/review-sessions": {
    async GET() {
      const items = (await listLatestReviewSessions()).map(toApi);
      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);
      if (typeof body.prUrl !== "string" || !body.prUrl) throw new ValidationError("prUrl is required");
      const model = optionalEnum(body.model, SESSION_MODELS, "model");
      const effort = optionalEnum(body.effort, SESSION_EFFORTS, "effort");
      return json(toApi(await startReviewSession(body.prUrl, { model, effort })), 202);
    },
  },

  // A pasted image for a prompt: saved to a temp file whose path goes into the
  // prompt text, so the session reads it like any other file.
  "/api/v1/sessions/images": {
    async POST(req) {
      const ext = IMAGE_TYPES[req.headers.get("content-type") ?? ""];
      if (!ext) throw new ValidationError(`Content-Type must be one of: ${Object.keys(IMAGE_TYPES).join(", ")}`);
      const dir = `${tmpdir()}/task-goblin-images`;
      await mkdir(dir, { recursive: true });
      const path = `${dir}/${crypto.randomUUID()}.${ext}`;
      await Bun.write(path, await req.arrayBuffer());
      return json({ path }, 201);
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

  "/api/v1/sessions/:id/respawn": {
    async POST(_req, params) {
      return json(toApi(await respawnSession(parseId(params.id))));
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

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
