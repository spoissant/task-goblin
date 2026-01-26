import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories, logs } from "../../db/schema";
import { json } from "../response";
import { NotFoundError, AppError } from "../lib/errors";
import { now } from "../lib/timestamp";
import {
  syncBranch,
  SyncBranchError,
} from "../services/sync-branch";
import type { Routes } from "../router";
import { existsSync } from "fs";
import { homedir } from "os";

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return path.replace("~", homedir());
  }
  return path;
}

async function logActivity(taskId: number, message: string) {
  await db.insert(logs).values({
    taskId,
    content: message,
    createdAt: now(),
    source: "sync",
  });
}

export const syncBranchRoutes: Routes = {
  "/api/v1/sync-branch/:taskId": {
    async POST(req, params) {
      const taskId = parseInt(params.taskId, 10);

      // Fetch task with repository
      const taskResult = await db
        .select({
          task: tasks,
          repository: repositories,
        })
        .from(tasks)
        .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
        .where(eq(tasks.id, taskId));

      if (taskResult.length === 0) {
        throw new NotFoundError("Task", taskId);
      }

      const { task, repository } = taskResult[0];

      // Validate task has a head branch
      if (!task.headBranch) {
        throw new AppError("Task has no associated branch", 400, "TASK_NO_BRANCH");
      }

      // Validate task has a base branch
      if (!task.baseBranch) {
        throw new AppError("Task has no base branch configured", 400, "TASK_NO_BASE_BRANCH");
      }

      // Validate repository exists
      if (!repository) {
        throw new AppError("Task has no associated repository", 400, "NO_REPOSITORY");
      }

      // Validate localPath is configured
      if (!repository.localPath) {
        throw new AppError(
          "Repository local path not configured",
          400,
          "REPO_PATH_NOT_CONFIGURED"
        );
      }

      // Validate localPath exists on filesystem (expand ~ to home dir)
      const expandedPath = expandPath(repository.localPath);
      if (!existsSync(expandedPath)) {
        throw new AppError(
          `Repository path does not exist: ${repository.localPath}`,
          400,
          "REPO_PATH_NOT_FOUND"
        );
      }

      try {
        const result = await syncBranch(
          repository.localPath,
          task.headBranch,
          task.baseBranch
        );

        if (result.status === "conflict") {
          await logActivity(
            taskId,
            `Sync from ${task.baseBranch} failed: merge conflict in ${result.conflictedFiles.join(", ")}`
          );
          return json(
            {
              error: {
                code: "MERGE_CONFLICT",
                message: "Merge conflict detected",
                details: { conflictedFiles: result.conflictedFiles },
              },
            },
            409
          );
        }

        await logActivity(
          taskId,
          `Synced from ${task.baseBranch} (${result.commitSha.substring(0, 7)})`
        );

        return json(result);
      } catch (err) {
        if (err instanceof SyncBranchError) {
          throw new AppError(err.message, 500, err.code);
        }
        throw err;
      }
    },
  },
};
