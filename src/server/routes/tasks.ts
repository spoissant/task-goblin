import { eq, and, sql, or } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { buildRepoMap, buildTitleSearchCondition, getTaskOrThrow } from "../lib/queries";
import { json, created, noContent } from "../response";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { GitHubApiError } from "../services/github-sync";
import { GitHubConfigError } from "../lib/github-client";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId, validatePagination } from "../lib/validation";
import {
  getCompletedCondition,
  getCompletedStatusNames,
  getNotCompletedCondition,
  getStatusCategories,
  getTaskOrderExprsAsync,
  isStatusValid,
} from "../lib/task-status";

async function validateManualStatus(status: string) {
  if (!(await isStatusValid(status))) {
    const statuses = await getStatusCategories();
    throw new ValidationError(
      `Manual task status must be one of: ${statuses.map((s) => s.name).join(", ")}`
    );
  }
}
import { teardownBeforeTaskDelete } from "../services/task-worktrees";
import { linkPrByBranch, linkPrToTask } from "../services/task-sync";
import type { Routes } from "../router";

function toGitHubAppError(err: unknown): unknown {
  if (err instanceof GitHubConfigError) {
    return new AppError(err.message, 400, err.code);
  }
  if (err instanceof GitHubApiError) {
    const statusCode =
      err.code === "GITHUB_AUTH_FAILED" ? 401 :
      err.code === "GITHUB_PR_NOT_FOUND" ? 404 :
      err.code === "GITHUB_REPO_NOT_CONFIGURED" ? 400 : 502;
    return new AppError(err.message, statusCode, err.code);
  }
  return err;
}

export const taskRoutes: Routes = {
  "/api/v1/tasks": {
    async GET(req) {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      const title = url.searchParams.get("title");
      const { limit, offset } = validatePagination(
        url.searchParams.get("limit"),
        url.searchParams.get("offset")
      );

      // Exclude completed tasks (/tasks/completed lists those)
      const conditions = [await getNotCompletedCondition()];

      if (status) {
        conditions.push(sql`LOWER(${tasks.status}) = ${status.toLowerCase()}`);
      }

      // Filter by multiple statuses (comma-separated, e.g. "Code Review,QA,Ready to Merge")
      const statusesParam = url.searchParams.get("statuses");
      if (statusesParam) {
        const statusList = statusesParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (statusList.length === 1) {
          conditions.push(sql`LOWER(${tasks.status}) = ${statusList[0]}`);
        } else if (statusList.length > 1) {
          conditions.push(sql`LOWER(${tasks.status}) IN (${sql.join(statusList.map((s) => sql`${s}`), sql`, `)})`);
        }
      }

      if (title) {
        const condition = buildTitleSearchCondition(title);
        if (condition) conditions.push(condition);
      }

      // Filter by checks status (passing / failing)
      const checks = url.searchParams.get("checks");
      if (checks === "passing" || checks === "failing") {
        conditions.push(eq(tasks.checksStatus, checks));
      }

      // Filter by unresolved comments
      const hasComments = url.searchParams.get("hasComments");
      if (hasComments === "true") {
        conditions.push(sql`COALESCE(${tasks.unresolvedCommentCount}, 0) > 0`);
      } else if (hasComments === "false") {
        conditions.push(sql`COALESCE(${tasks.unresolvedCommentCount}, 0) = 0`);
      }

      const whereCondition = and(...conditions);

      const taskList = await db
        .select()
        .from(tasks)
        .where(whereCondition)
        .orderBy(...(await getTaskOrderExprsAsync()))
        .limit(limit)
        .offset(offset);

      const repoMap = await buildRepoMap(taskList);

      // Which of the returned tasks are parents. Looked up across the whole
      // table (not just this page) so the flag holds even when the children
      // are filtered out or already completed.
      const parentKeys = new Set<string>();
      const jiraKeys = taskList.map((t) => t.jiraKey).filter((k): k is string => !!k);
      if (jiraKeys.length > 0) {
        const keyList = sql.join(jiraKeys.map((k) => sql`${k}`), sql`, `);
        const children = await db
          .select({ parentKey: tasks.parentKey, epicKey: tasks.epicKey })
          .from(tasks)
          .where(
            or(
              sql`${tasks.parentKey} IN (${keyList})`,
              sql`${tasks.epicKey} IN (${keyList})`
            )
          );
        for (const child of children) {
          if (child.parentKey) parentKeys.add(child.parentKey);
          if (child.epicKey) parentKeys.add(child.epicKey);
        }
      }

      const items = taskList.map((task) => ({
        ...task,
        repository: task.repositoryId ? repoMap.get(task.repositoryId) || null : null,
        hasChildren: !!task.jiraKey && parentKeys.has(task.jiraKey),
      }));

      // Get total count for pagination
      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(whereCondition);
      const total = totalResult[0]?.count ?? items.length;

      return json({ items, total });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      if (body.status) {
        await validateManualStatus(body.status);
      }

      const timestamp = now();
      const result = await db
        .insert(tasks)
        .values({
          title: body.title,
          description: body.description || null,
          status: body.status || "To Do",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/tasks/:id": {
    async GET(_req, params) {
      const id = parseId(params.id);
      const task = await getTaskOrThrow(id);

      // Get repository if task has one
      let repository = null;
      if (task.repositoryId) {
        const repoResult = await db
          .select()
          .from(repositories)
          .where(eq(repositories.id, task.repositoryId));
        repository = repoResult[0] || null;
      }

      return json({
        ...task,
        repository,
      });
    },

    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await getTaskOrThrow(id);

      if (body.status) {
        if (existing.jiraKey) {
          throw new ValidationError("Cannot change status of Jira-linked task");
        }
        await validateManualStatus(body.status);
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      // Use 'in' operator to allow explicitly setting fields to null
      if ("title" in body) updates.title = body.title;
      if ("description" in body) updates.description = body.description;
      if ("status" in body) updates.status = body.status;
      if ("highPriority" in body) updates.highPriority = body.highPriority ? 1 : 0;
      if ("onIce" in body) updates.onIce = body.onIce ? 1 : 0;
      if ("onIceReason" in body) updates.onIceReason = body.onIceReason ?? null;
      if ("choreSkips" in body) updates.choreSkips = body.choreSkips;
      if ("repositoryId" in body) {
        // The repository of a PR-backed task is owned by the GitHub sync.
        if (existing.prNumber !== null) {
          throw new ValidationError("Cannot change repository of a task with a PR");
        }
        if (body.repositoryId !== null) {
          const repoId = Number(body.repositoryId);
          const repo = await db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, repoId));
          if (!Number.isInteger(repoId) || repo.length === 0) {
            throw new ValidationError("Unknown repositoryId");
          }
          updates.repositoryId = repoId;
        } else {
          updates.repositoryId = null;
        }
      }

      const result = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(_req, params) {
      const id = parseId(params.id);

      await getTaskOrThrow(id);
      await teardownBeforeTaskDelete(id);

      await db.delete(tasks).where(eq(tasks.id, id));

      return noContent();
    },
  },

  // Manually attach a PR (by GitHub URL) to an existing task
  "/api/v1/tasks/:id/assign-pr": {
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      const url = typeof body.url === "string" ? body.url.trim() : "";

      if (!url) {
        throw new ValidationError("url is required");
      }

      const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/);
      if (!match) {
        throw new ValidationError(
          "Invalid PR URL. Expected format: https://github.com/<owner>/<repo>/pull/<number>"
        );
      }

      const [, owner, repo, numberStr] = match;
      const prNumber = parseInt(numberStr, 10);

      const existing = await getTaskOrThrow(id);
      if (existing.prNumber) {
        throw new ValidationError("Task already has a PR assigned");
      }

      try {
        return json(await linkPrToTask(id, owner, repo, prNumber));
      } catch (err) {
        throw toGitHubAppError(err);
      }
    },
  },

  // Link the PR opened from the task's branch (its headBranch, else its worktree's
  // branch). A no-op that returns the task when it already has a PR, has no
  // branch or repository, or no PR exists for the branch yet.
  "/api/v1/tasks/:id/link-pr-by-branch": {
    async POST(_req, params) {
      const id = parseId(params.id);
      try {
        return json(await linkPrByBranch(id));
      } catch (err) {
        throw toGitHubAppError(err);
      }
    },
  },

  // Get completed tasks with pagination
  "/api/v1/tasks/completed": {
    async GET(req) {
      const url = new URL(req.url);
      const { limit, offset } = validatePagination(
        url.searchParams.get("limit") || "25",
        url.searchParams.get("offset")
      );
      const showDone = url.searchParams.get("showDone") === "true";
      const title = url.searchParams.get("title");

      const conditions = [await getCompletedCondition()];
      if (!showDone) {
        // Hide anything whose status belongs to a "done" category, so the page
        // only keeps tasks completed via their PR (merged/closed) but not Jira.
        const doneStatuses = await getCompletedStatusNames();
        if (doneStatuses.length > 0) {
          conditions.push(
            sql`LOWER(${tasks.status}) NOT IN (${sql.join(doneStatuses.map((s) => sql`${s}`), sql`, `)})`
          );
        }
      }
      if (title) {
        const condition = buildTitleSearchCondition(title);
        if (condition) conditions.push(condition);
      }
      const whereCondition = and(...conditions);

      // Get paginated completed tasks
      const taskList = await db
        .select()
        .from(tasks)
        .where(whereCondition)
        .orderBy(...(await getTaskOrderExprsAsync()))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(whereCondition);
      const total = totalResult[0]?.count ?? 0;

      const repoMap = await buildRepoMap(taskList);

      const items = taskList.map((task) => ({
        ...task,
        repository: task.repositoryId ? repoMap.get(task.repositoryId) || null : null,
      }));

      return json({ items, total, limit, offset });
    },
  },

  // Get task by Jira key
  "/api/v1/tasks/by-jira-key/:key": {
    async GET(_req, params) {
      const { key } = params;
      const result = await db
        .select()
        .from(tasks)
        .where(eq(tasks.jiraKey, key));

      if (result.length === 0) {
        throw new NotFoundError("Task with jiraKey", key);
      }

      return json(result[0]);
    },
  },

  // Get task by branch name
  "/api/v1/tasks/by-branch/:branch": {
    async GET(_req, params) {
      const { branch } = params;
      const result = await db
        .select()
        .from(tasks)
        .where(eq(tasks.headBranch, branch));

      if (result.length === 0) {
        throw new NotFoundError("Task with branch", branch);
      }

      if (result.length > 1) {
        throw new ValidationError(
          `Multiple tasks found with branch "${branch}". Use task ID or Jira key instead.`
        );
      }

      return json(result[0]);
    },
  },

  // Get task by PR number (optionally filtered by repo)
  "/api/v1/tasks/by-pr/:prNumber": {
    async GET(req, params) {
      const prNumber = parseId(params.prNumber);
      const url = new URL(req.url);
      const repo = url.searchParams.get("repo"); // format: owner/repo

      let result;
      if (repo) {
        const [owner, repoName] = repo.split("/");
        if (!owner || !repoName) {
          throw new ValidationError("repo must be in format owner/repo");
        }
        // Join with repositories to filter by owner/repo
        result = await db
          .select({ task: tasks })
          .from(tasks)
          .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
          .where(
            and(
              eq(tasks.prNumber, prNumber),
              eq(repositories.owner, owner),
              eq(repositories.repo, repoName)
            )
          );
        result = result.map((r) => r.task);
      } else {
        result = await db
          .select()
          .from(tasks)
          .where(eq(tasks.prNumber, prNumber));
      }

      if (result.length === 0) {
        const identifier = repo ? `PR #${prNumber} in ${repo}` : `PR #${prNumber}`;
        throw new NotFoundError("Task with", identifier);
      }

      if (result.length > 1) {
        throw new ValidationError(
          `Multiple tasks found with PR #${prNumber}. Add ?repo=owner/repo to filter.`
        );
      }

      return json(result[0]);
    },
  },
};
