import type { Routes } from "../router";
import { taskRoutes } from "./tasks";
import { todoRoutes } from "./todos";
import { blockedByRoutes } from "./blocked-by";
import { repositoryRoutes } from "./repositories";
import { settingsRoutes } from "./settings";
import { githubRoutes } from "./github";
import { logRoutes } from "./logs";
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
  ...todoRoutes,
  ...blockedByRoutes,
  ...repositoryRoutes,
  ...settingsRoutes,
  ...githubRoutes,
  ...logRoutes,
};
