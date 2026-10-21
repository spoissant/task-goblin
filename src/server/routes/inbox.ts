import { json } from "../response";
import { listInbox } from "../services/inbox";
import type { Routes } from "../router";

export const inboxRoutes: Routes = {
  // Everything waiting on the user, newest first (see shared/inbox.ts for the item kinds).
  "/api/v1/inbox": {
    async GET() {
      const items = await listInbox();
      return json({ items, total: items.length });
    },
  },
};
