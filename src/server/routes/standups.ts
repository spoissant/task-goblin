import { json } from "../response";
import { parseId } from "../lib/validation";
import { getBody } from "../lib/request";
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
  // Optional { notes } tell the drafting session what differs today, e.g. where the thread is.
  "/api/v1/standups/:id/slack-draft": {
    async POST(req, params) {
      const { notes } = req.body ? await getBody<{ notes?: string }>(req) : {};
      return json(await draftToSlack(parseId(params.id), notes?.trim() || undefined));
    },
  },
};
