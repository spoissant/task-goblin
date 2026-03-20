import type { Routes } from "../router";
import { taskRoutes } from "./tasks";
import { taskMergeRoutes } from "../services/task-merge";
import { todoRoutes } from "./todos";
import { repositoryRoutes } from "./repositories";
import { settingsRoutes } from "./settings";
import { githubRoutes } from "./github";

import { deployRoutes } from "./deploy";
import { syncBranchRoutes } from "./sync-branch";
import { noteRoutes } from "./notes";
import { worktreeRoutes } from "./worktrees";
import { json } from "../response";

const healthRoute: Routes = {
  "/api/v1/health": {
    GET() {
      return json({ status: "ok", timestamp: new Date().toISOString() });
    },
  },
};

export const routes: Routes = {
  ...healthRoute,
  ...taskRoutes,
  ...taskMergeRoutes,
  ...todoRoutes,
  ...repositoryRoutes,
  ...settingsRoutes,
  ...githubRoutes,

  ...deployRoutes,
  ...syncBranchRoutes,
  ...noteRoutes,
  ...worktreeRoutes,
};
