import { json } from "../response";
import { parseId } from "../lib/validation";
import { bootDevStack, getDevStackStatus, stopDevStack } from "../services/dev-stack";
import type { Routes } from "../router";

export const devStackRoutes: Routes = {
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
