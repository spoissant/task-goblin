import { json } from "../response";
import { parseId } from "../lib/validation";
import { mergeTaskPr } from "../services/merge-gate";
import type { Routes } from "../router";

export const mergeGateRoutes: Routes = {
  // The Merge button: squash-merge a PR the merge gate cleared.
  "/api/v1/tasks/:id/merge-pr": {
    async POST(_req, params) {
      return json(await mergeTaskPr(parseId(params.id)));
    },
  },
};
