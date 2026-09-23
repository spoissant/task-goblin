import { json } from "../response";
import { parseId } from "../lib/validation";
import { bootDevStack, getDevStackOverview, getDevStackStatus, stopDevStack } from "../services/dev-stack";
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
      return json(await getDevStackStatus(parseId(params.id)));
    },

    // Boot the task branch in the main checkout; finishes in the background.
    async POST(_req, params) {
      return json(await bootDevStack(parseId(params.id)), 202);
    },

    // Stop the stack and return the main checkout to its base branch.
    async DELETE(_req, params) {
      return json(await stopDevStack(parseId(params.id)), 202);
    },
  },
};
