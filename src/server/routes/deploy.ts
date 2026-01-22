import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories, logs } from "../../db/schema";
import { json } from "../response";
import { NotFoundError, ValidationError, AppError } from "../lib/errors";
import { getBody } from "../lib/request";
import { now } from "../lib/timestamp";
import {
  deployBranch,
  deployBulk,
  DeployError,
  type TaskBranchInfo,
} from "../services/deploy-branch";
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
    source: "deploy",
  });
}

export const deployRoutes: Routes = {
  "/api/v1/deploy/:taskId": {
    async POST(req, params) {
      const taskId = parseInt(params.taskId, 10);
      const body = await getBody(req);

      if (!body.targetBranch || typeof body.targetBranch !== "string") {
        throw new ValidationError("targetBranch is required");
      }

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

      // Validate task has a branch
      if (!task.headBranch) {
        throw new AppError("Task has no associated branch", 400, "TASK_NO_BRANCH");
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

      // Validate targetBranch is in deploymentBranches
      const deploymentBranches: string[] = repository.deploymentBranches
        ? JSON.parse(repository.deploymentBranches)
        : [];
      if (!deploymentBranches.includes(body.targetBranch)) {
        throw new ValidationError(
          `Invalid target branch. Allowed: ${deploymentBranches.join(", ")}`
        );
      }

      try {
        const result = await deployBranch(
          repository.localPath,
          task.headBranch,
          body.targetBranch
        );

        if (result.status === "conflict") {
          await logActivity(
            taskId,
            `Deploy to ${body.targetBranch} failed: merge conflict in ${result.conflictedFiles.join(", ")}`
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
          `Deployed to ${body.targetBranch} (${result.commitSha.substring(0, 7)})`
        );

        return json(result);
      } catch (err) {
        if (err instanceof DeployError) {
          throw new AppError(err.message, 500, err.code);
        }
        throw err;
      }
    },
  },

  "/api/v1/deploy/bulk": {
    async POST(req) {
      const body = await getBody(req);

      if (!Array.isArray(body.taskIds) || body.taskIds.length === 0) {
        throw new ValidationError("taskIds must be a non-empty array");
      }
      if (!body.targetBranch || typeof body.targetBranch !== "string") {
        throw new ValidationError("targetBranch is required");
      }

      const taskIds = body.taskIds.map((id: unknown) => {
        if (typeof id !== "number") {
          throw new ValidationError("taskIds must contain only numbers");
        }
        return id;
      });

      // Fetch all tasks with repositories
      const taskResults = await db
        .select({
          task: tasks,
          repository: repositories,
        })
        .from(tasks)
        .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
        .where(inArray(tasks.id, taskIds));

      if (taskResults.length === 0) {
        throw new NotFoundError("Tasks", taskIds.join(", "));
      }

      // Validate all tasks are from the same repository
      const repoIds = new Set<number>();
      for (const { task, repository } of taskResults) {
        if (repository?.id) {
          repoIds.add(repository.id);
        }
      }

      if (repoIds.size === 0) {
        throw new AppError(
          "No tasks have associated repositories",
          400,
          "NO_REPOSITORY"
        );
      }

      if (repoIds.size > 1) {
        throw new AppError(
          "All tasks must be from the same repository for bulk deploy",
          400,
          "MULTIPLE_REPOSITORIES"
        );
      }

      // Get the repository (we know there's exactly one)
      const repository = taskResults.find((r) => r.repository)?.repository;
      if (!repository) {
        throw new AppError("Repository not found", 400, "NO_REPOSITORY");
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

      // Validate targetBranch is in deploymentBranches
      const deploymentBranches: string[] = repository.deploymentBranches
        ? JSON.parse(repository.deploymentBranches)
        : [];
      if (!deploymentBranches.includes(body.targetBranch)) {
        throw new ValidationError(
          `Invalid target branch. Allowed: ${deploymentBranches.join(", ")}`
        );
      }

      // Prepare task branch info
      const taskBranchInfos: TaskBranchInfo[] = taskResults.map(({ task }) => ({
        taskId: task.id,
        headBranch: task.headBranch,
      }));

      try {
        const result = await deployBulk(
          repository.localPath,
          taskBranchInfos,
          body.targetBranch
        );

        // Log activity for each task
        for (const taskResult of result.results) {
          if (taskResult.status === "success") {
            await logActivity(
              taskResult.taskId,
              `Deployed to ${body.targetBranch} (${taskResult.commitSha?.substring(0, 7)})`
            );
          } else if (taskResult.status === "conflict") {
            await logActivity(
              taskResult.taskId,
              `Deploy to ${body.targetBranch} failed: merge conflict in ${taskResult.conflictedFiles?.join(", ")}`
            );
          }
        }

        return json(result);
      } catch (err) {
        if (err instanceof DeployError) {
          throw new AppError(err.message, 500, err.code);
        }
        throw err;
      }
    },
  },
};
