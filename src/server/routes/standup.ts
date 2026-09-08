import type { Routes } from "../router";
import { json } from "../response";
import {
  StandupRangeError,
  buildReport,
  listSnapshotDates,
  writeSnapshot,
  type StandupReport,
} from "../../standup/service";

export interface StandupResponse {
  report: StandupReport | null;
  available: string[];
  /** Why there is no report, when there isn't one. */
  reason: string | null;
}

export const standupRoutes: Routes = {
  "/api/v1/standup": {
    async GET(req) {
      const params = new URL(req.url).searchParams;
      try {
        const report = await buildReport({
          from: params.get("from"),
          to: params.get("to"),
        });
        return json<StandupResponse>({ report, available: report.available, reason: null });
      } catch (err) {
        // Too few snapshots is the normal first-run state, not a failure —
        // the page renders an explanation and a "take one now" button.
        if (err instanceof StandupRangeError) {
          return json<StandupResponse>({
            report: null,
            available: err.available,
            reason: err.message,
          });
        }
        throw err;
      }
    },
  },

  "/api/v1/standup/snapshots": {
    async GET() {
      const dates = await listSnapshotDates();
      return json({ items: dates, total: dates.length });
    },
    async POST(req) {
      const body = (await req.json().catch(() => ({}))) as {
        force?: boolean;
        synced?: boolean;
      };
      // The page syncs Jira/GitHub before calling this, so it tells us whether
      // that succeeded — otherwise the snapshot would claim no sync happened.
      const result = await writeSnapshot({
        force: body.force === true,
        syncTriggered: body.synced === true,
      });
      return json(result);
    },
  },
};
