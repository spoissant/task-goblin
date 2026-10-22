import { json } from "../response";
import { getChores, getChoreDefinitions } from "../lib/chores";
import type { Routes } from "../router";

export const choreRoutes: Routes = {
  "/api/v1/chores/definitions": {
    GET() {
      return json({ items: getChoreDefinitions() });
    },
  },
  "/api/v1/chores": {
    async GET() {
      const items = await getChores();
      return json({ items });
    },
  },
};
