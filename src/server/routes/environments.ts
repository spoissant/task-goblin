import { json } from "../response";
import { getEnvironmentStatuses } from "../services/environments";
import type { Routes } from "../router";

export const environmentRoutes: Routes = {
  // Deploy and Playwright gate status of staging and barney, read live from Buildkite.
  "/api/v1/environments": {
    async GET() {
      const items = await getEnvironmentStatuses();
      return json({ items, total: items.length });
    },
  },
};
