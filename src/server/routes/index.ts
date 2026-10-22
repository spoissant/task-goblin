import type { Routes } from "../router";
import { taskRoutes } from "./tasks";
import { taskLinkRoutes } from "./task-links";
import { repositoryRoutes } from "./repositories";
import { settingsRoutes } from "./settings";
import { githubRoutes } from "./github";
import { taskWorktreeRoutes } from "./task-worktrees";
import { devStackRoutes } from "./dev-stack";
import { sessionRoutes } from "./sessions";
import { teamChannelRoutes } from "./team-channels";
import { choreRoutes } from "./chores";
import { standupRoutes } from "./standups";

export const routes: Routes = {
  ...taskRoutes,
  ...taskLinkRoutes,
  ...repositoryRoutes,
  ...settingsRoutes,
  ...githubRoutes,
  ...taskWorktreeRoutes,
  ...devStackRoutes,
  ...sessionRoutes,
  ...teamChannelRoutes,
  ...choreRoutes,
  ...standupRoutes,
};
