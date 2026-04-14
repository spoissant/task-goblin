import { json } from "../response";
import { ValidationError } from "../lib/errors";
import { getChores, getChoreDefinitions, type GetChoresOptions } from "../lib/chores";
import type { Routes } from "../router";

function parseParams(url: URL): GetChoresOptions {
  const opts: GetChoresOptions = {};

  const minChoreParam = url.searchParams.get("minChore");
  if (minChoreParam !== null) {
    const n = parseInt(minChoreParam, 10);
    if (isNaN(n) || n < 1) throw new ValidationError("minChore must be a positive integer");
    opts.minChore = n;
  }

  const maxChoreParam = url.searchParams.get("maxChore");
  if (maxChoreParam !== null) {
    const n = parseInt(maxChoreParam, 10);
    if (isNaN(n) || n < 1) throw new ValidationError("maxChore must be a positive integer");
    opts.maxChore = n;
  }

  const repository = url.searchParams.get("repository");
  if (repository !== null) {
    if (!repository.includes("/")) throw new ValidationError("repository must be in owner/repo format");
    opts.repository = repository;
  }

  return opts;
}

export const choreRoutes: Routes = {
  "/api/v1/chores/definitions": {
    GET() {
      return json({ items: getChoreDefinitions() });
    },
  },
  "/api/v1/chores": {
    async GET(req) {
      const opts = parseParams(new URL(req.url));
      const items = await getChores(opts);
      return json({ items });
    },
  },
  "/api/v1/chores/next": {
    async GET(req) {
      const opts = parseParams(new URL(req.url));
      const items = await getChores(opts);
      return json(items[0] ?? null);
    },
  },
};
