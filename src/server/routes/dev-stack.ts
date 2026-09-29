import { json } from "../response";
import { ValidationError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { bootDevStack, getDevStackOverview, getDevStackStatus, refreshDevStack, stopDevStack } from "../services/dev-stack";
import type { Routes } from "../router";

export const devStackRoutes: Routes = {
  // The one stack plus which repositories support it; feeds the table rows.
  "/api/v1/dev-stack": {
    async GET() {
      return json(await getDevStackOverview());
    },
  },

  "/api/v1/tasks/:id/dev-stack": {
    async GET(_req, params) {
      return json(await getDevStackStatus({ taskId: parseId(params.id) }));
    },

    // Boot the task branch in the main checkout; finishes in the background.
    async POST(_req, params) {
      return json(await bootDevStack({ taskId: parseId(params.id) }), 202);
    },

    // Stop the stack and return the main checkout to its base branch.
    async DELETE(_req, params) {
      return json(await stopDevStack({ taskId: parseId(params.id) }), 202);
    },
  },

  // Move the running stack's checkout to the latest commit of the task branch.
  "/api/v1/tasks/:id/dev-stack/refresh": {
    async POST(_req, params) {
      return json(await refreshDevStack({ taskId: parseId(params.id) }));
    },
  },

  // A PR without a task (colleagues' PRs on the Reviews page), by URL.
  "/api/v1/dev-stack/pr": {
    async POST(req) {
      return json(await bootDevStack(await prOwner(req)), 202);
    },
  },

  "/api/v1/dev-stack/pr/stop": {
    async POST(req) {
      return json(await stopDevStack(await prOwner(req)), 202);
    },
  },

  "/api/v1/dev-stack/pr/refresh": {
    async POST(req) {
      return json(await refreshDevStack(await prOwner(req)));
    },
  },
};

async function prOwner(req: Request): Promise<{ prUrl: string }> {
  const body = await getBody(req);
  if (typeof body.prUrl !== "string" || !body.prUrl) throw new ValidationError("prUrl is required");
  return { prUrl: body.prUrl };
}
