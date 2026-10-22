import { json } from "../response";
import { ValidationError } from "../lib/errors";
import { getTaskOrThrow } from "../lib/queries";
import { getBody } from "../lib/request";
import { parseId, parsePrUrl } from "../lib/validation";
import { mergeTaskPr } from "../services/merge-gate";
import { linkJiraToTask, linkPrToTask, syncTaskDetail } from "../services/task-sync";
import type { Routes } from "../router";

// A task's links to its PR and its Jira issue: attaching one by hand,
// re-pulling both, and the Merge button.
export const taskLinkRoutes: Routes = {
  // Manually attach a PR (by GitHub URL) to an existing task
  "/api/v1/tasks/:id/assign-pr": {
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      if (typeof body.url !== "string" || !body.url.trim()) throw new ValidationError("url is required");
      const { owner, repo, number } = parsePrUrl(body.url);

      const existing = await getTaskOrThrow(id);
      if (existing.prNumber) throw new ValidationError("Task already has a PR assigned");

      return json(await linkPrToTask(id, owner, repo, number));
    },
  },

  // Manually attach a Jira issue (by key) to a PR task that has none
  "/api/v1/tasks/:id/assign-jira": {
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      const key = typeof body.key === "string" ? body.key.trim().toUpperCase() : "";
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
        throw new ValidationError("Invalid Jira key. Expected format: PROJ-123");
      }
      return json(await linkJiraToTask(id, key));
    },
  },

  // Re-pull one task: its Jira issue, its PR (or the one opened from its
  // branch), its worktree's git status. Each source's failure is in `errors`.
  "/api/v1/tasks/:id/sync": {
    async POST(_req, params) {
      return json(await syncTaskDetail(parseId(params.id)));
    },
  },

  // The Merge button: squash-merge a PR the merge gate cleared.
  "/api/v1/tasks/:id/merge-pr": {
    async POST(_req, params) {
      return json(await mergeTaskPr(parseId(params.id)));
    },
  },
};
