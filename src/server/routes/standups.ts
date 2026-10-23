import { json } from "../response";
import { parseId } from "../lib/validation";
import { draftToSlack, listStandups, startStandup, toApi } from "../services/standup";
import type { Routes } from "../router";

export const standupRoutes: Routes = {
  // Recent standups, newest first; POST generates a new one (202, state running).
  "/api/v1/standups": {
    async GET() {
      const items = (await listStandups()).map(toApi);
      return json({ items, total: items.length });
    },

    async POST() {
      return json(toApi(await startStandup()), 202);
    },
  },

  // Drafts the standup in today's Slack async-update thread (never sends); returns { link }.
  "/api/v1/standups/:id/slack-draft": {
    async POST(_req, params) {
      return json(await draftToSlack(parseId(params.id)));
    },
  },
};
