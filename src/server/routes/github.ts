import { json } from "../response";
import { getGitHubClient } from "../lib/github-client";
import { fetchMyTeams } from "../services/github-teams";
import { listReviewRequests } from "../services/github-review-requests";
import { getNextSyncAt, syncNow } from "../services/sync-scheduler";
import type { Routes } from "../router";

export const githubRoutes: Routes = {
  // One full sync pass (Jira, GitHub, worktree git statuses, then the merge
  // watch, Ready to Prod move, merge gate and auto chores), or the one already
  // running; then the countdown restarts. Step failures are in `errors`.
  "/api/v1/sync": {
    async POST() {
      return json(await syncNow());
    },
  },

  // When the next auto sync pass starts; null while the scheduler is off.
  "/api/v1/sync/next": {
    GET() {
      return json({ nextSyncAt: getNextSyncAt() });
    },
  },

  "/api/v1/github/teams": {
    async GET() {
      const items = await fetchMyTeams(getGitHubClient());
      return json({ items, total: items.length });
    },
  },

  "/api/v1/github/review-requests": {
    async GET(req) {
      const scope = new URL(req.url).searchParams.get("scope") === "mine" ? "mine" : "others";
      const items = await listReviewRequests(scope);
      return json({ items, total: items.length });
    },
  },
};
