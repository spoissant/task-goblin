import type { Routes } from "../router";
import { taskRoutes } from "./tasks";
import { taskMergeRoutes } from "../services/task-merge";
import { repositoryRoutes } from "./repositories";
import { settingsRoutes } from "./settings";
import { githubRoutes } from "./github";
import { worktreeRoutes } from "./worktrees";
import { taskWorktreeRoutes } from "./task-worktrees";
import { devStackRoutes } from "./dev-stack";
import { sessionRoutes } from "./sessions";
import { teamChannelRoutes } from "./team-channels";
import { choreRoutes } from "./chores";
import { standupRoutes } from "./standups";
import { mergeGateRoutes } from "./merge-gate";

export const routes: Routes = {
  ...taskRoutes,
  ...taskMergeRoutes,
  ...repositoryRoutes,
  ...settingsRoutes,
  ...githubRoutes,
  ...worktreeRoutes,
  ...taskWorktreeRoutes,
  ...devStackRoutes,
  ...sessionRoutes,
  ...teamChannelRoutes,
  ...choreRoutes,
  ...standupRoutes,
  ...mergeGateRoutes,
};
