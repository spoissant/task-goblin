import { eq, and, sql, ne, isNull, isNotNull, or, like } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, repositories, noteTasks, notes } from "../../db/schema";
import { buildRepoMap, getTaskOrThrow } from "../lib/queries";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId, validatePagination } from "../lib/validation";
import {
  getCompletedCondition,
  getNotCompletedCondition,
  getStatusOrderExprAsync,
  isStatusValid,
  getAllStatuses,
} from "../lib/task-status";

async function validateManualStatus(status: string) {
  if (!(await isStatusValid(status))) {
    const statuses = await getAllStatuses();
    throw new ValidationError(
      `Manual task status must be one of: ${statuses.map((s) => s.name).join(", ")}`
    );
  }
}
import type { Routes } from "../router";

export const taskRoutes: Routes = {
  "/api/v1/tasks": {
    async GET(req) {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      const orphanJira = url.searchParams.get("orphanJira");
      const orphanPr = url.searchParams.get("orphanPr");
      const linked = url.searchParams.get("linked");
      const title = url.searchParams.get("title");
      const excludeCompleted = url.searchParams.get("excludeCompleted") !== "false"; // default true
      const { limit, offset } = validatePagination(
        url.searchParams.get("limit"),
        url.searchParams.get("offset")
      );

      const conditions = [];

      // Exclude completed tasks by default
      if (excludeCompleted) {
        conditions.push(await getNotCompletedCondition());
      }

      if (status) {
        conditions.push(eq(tasks.status, status));
      }

      // Filter by multiple statuses (comma-separated, e.g. "Code Review,QA,Ready to Merge")
      const statusesParam = url.searchParams.get("statuses");
      if (statusesParam) {
        const statusList = statusesParam.split(",").map((s) => s.trim()).filter(Boolean);
        if (statusList.length === 1) {
          conditions.push(eq(tasks.status, statusList[0]));
        } else if (statusList.length > 1) {
          conditions.push(sql`${tasks.status} IN (${sql.join(statusList.map((s) => sql`${s}`), sql`, `)})`);
        }
      }

      // Filter for orphan Jira tasks (jiraKey set, no prNumber)
      if (orphanJira === "true") {
        conditions.push(isNotNull(tasks.jiraKey));
        conditions.push(isNull(tasks.prNumber));
      }

      // Filter for orphan PR tasks (prNumber set, no jiraKey)
      if (orphanPr === "true") {
        conditions.push(isNotNull(tasks.prNumber));
        conditions.push(isNull(tasks.jiraKey));
      }

      if (title) {
        const orConditions = [
          like(tasks.title, `%${title}%`),
          like(tasks.jiraKey, `%${title}%`),
          like(tasks.headBranch, `%${title}%`),
        ];
        const parsed = Number(title);
        if (Number.isInteger(parsed) && parsed > 0) {
          orConditions.push(eq(tasks.id, parsed));
        }
        conditions.push(or(...orConditions));
      }

      // Filter by checks status (passing / failing)
      const checks = url.searchParams.get("checks");
      if (checks === "passing" || checks === "failing") {
        conditions.push(eq(tasks.checksStatus, checks));
      }

      // Filter by max approved review count (fewer than N)
      const maxReviews = url.searchParams.get("maxReviews");
      if (maxReviews !== null) {
        const n = parseInt(maxReviews, 10);
        if (!isNaN(n)) {
          conditions.push(sql`COALESCE(${tasks.approvedReviewCount}, 0) < ${n}`);
        }
      }

      // Filter by unresolved comments
      const hasComments = url.searchParams.get("hasComments");
      if (hasComments === "true") {
        conditions.push(sql`COALESCE(${tasks.unresolvedCommentCount}, 0) > 0`);
      } else if (hasComments === "false") {
        conditions.push(sql`COALESCE(${tasks.unresolvedCommentCount}, 0) = 0`);
      }

      // Filter for linked tasks (manual OR both jiraKey and prNumber set)
      if (linked === "true") {
        conditions.push(
          or(
            // Manual tasks: neither jiraKey nor prNumber
            and(isNull(tasks.jiraKey), isNull(tasks.prNumber)),
            // Merged tasks: both jiraKey and prNumber
            and(isNotNull(tasks.jiraKey), isNotNull(tasks.prNumber))
          )
        );
      }

      let query = db.select().from(tasks);

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      query = query.orderBy(await getStatusOrderExprAsync()) as typeof query;

      // Apply pagination
      query = query.limit(limit).offset(offset) as typeof query;

      const taskList = await query;

      // Get all pending todos for each task
      const taskIds = taskList.map((t) => t.id);
      const pendingTodosMap = new Map<number, { id: number; content: string; position: number | null }[]>();

      if (taskIds.length > 0) {
        // Get all incomplete todos for each task, ordered by position
        const allPendingTodos = await db
          .select({
            taskId: todos.taskId,
            id: todos.id,
            content: todos.content,
            position: todos.position,
          })
          .from(todos)
          .where(
            and(
              sql`${todos.taskId} IN (${sql.join(taskIds.map(id => sql`${id}`), sql`, `)})`,
              sql`${todos.done} IS NULL`
            )
          )
          .orderBy(sql`COALESCE(${todos.position}, 999999)`);

        // Group todos by task
        for (const todo of allPendingTodos) {
          if (todo.taskId) {
            const existing = pendingTodosMap.get(todo.taskId) || [];
            existing.push({ id: todo.id, content: todo.content, position: todo.position });
            pendingTodosMap.set(todo.taskId, existing);
          }
        }
      }

      const repoMap = await buildRepoMap(taskList);

      const items = taskList.map((task) => ({
        ...task,
        pendingTodos: pendingTodosMap.get(task.id) || [],
        repository: task.repositoryId ? repoMap.get(task.repositoryId) || null : null,
      }));

      // Get total count for pagination
      let totalQuery = db.select({ count: sql<number>`count(*)` }).from(tasks);
      if (conditions.length > 0) {
        totalQuery = totalQuery.where(and(...conditions)) as typeof totalQuery;
      }
      const totalResult = await totalQuery;
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
    async GET(req, params) {
      const id = parseId(params.id);
      const task = await getTaskOrThrow(id);

      // Get related entities
      const taskTodos = await db
        .select()
        .from(todos)
        .where(eq(todos.taskId, id));

      // Get repository if task has one
      let repository = null;
      if (task.repositoryId) {
        const repoResult = await db
          .select()
          .from(repositories)
          .where(eq(repositories.id, task.repositoryId));
        repository = repoResult[0] || null;
      }

      // Get linked notes for this task
      const linkedNotes = await db
        .select({
          id: notes.id,
          title: notes.title,
        })
        .from(noteTasks)
        .innerJoin(notes, eq(noteTasks.noteId, notes.id))
        .where(eq(noteTasks.taskId, id));

      return json({
        ...task,
        todos: taskTodos,
        repository,
        notes: linkedNotes,
      });
    },

    async PUT(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      if (body.status) {
        await validateManualStatus(body.status);
      }

      const existing = await getTaskOrThrow(id);

      const result = await db
        .update(tasks)
        .set({
          title: body.title,
          description: body.description ?? null,
          status: body.status || existing.status,
          updatedAt: now(),
        })
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
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
      if ("choreSkips" in body) updates.choreSkips = body.choreSkips;
      if ("workingOn" in body) updates.workingOn = body.workingOn;

      const result = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);

      await getTaskOrThrow(id);

      // Cascade delete: todos
      await db
        .delete(todos)
        .where(eq(todos.taskId, id));

      await db.delete(tasks).where(eq(tasks.id, id));

      return noContent();
    },
  },

  // Reserve a task for a chore (atomic check-and-set, 30-min TTL)
  "/api/v1/tasks/:id/reserve": {
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      const choreKey = body.choreKey as string | undefined;
      if (!choreKey) throw new ValidationError("choreKey is required");

      const TTL_MS = 30 * 60 * 1000;
      const expiredBefore = new Date(Date.now() - TTL_MS).toISOString();

      const result = await db
        .update(tasks)
        .set({ workingOn: JSON.stringify({ choreKey, at: new Date().toISOString() }), updatedAt: now() })
        .where(
          and(
            eq(tasks.id, id),
            or(
              isNull(tasks.workingOn),
              sql`JSON_EXTRACT(${tasks.workingOn}, '$.at') < ${expiredBefore}`
            )
          )
        )
        .returning();

      if (result.length === 0) {
        const existing = await getTaskOrThrow(id);
        return Response.json(
          { error: { code: "ALREADY_RESERVED", message: "Task is already reserved", workingOn: existing.workingOn } },
          { status: 409 }
        );
      }

      return json(result[0]);
    },
  },

  // Release a task reservation
  "/api/v1/tasks/:id/release": {
    async POST(_req, params) {
      const id = parseId(params.id);
      await getTaskOrThrow(id);

      const result = await db
        .update(tasks)
        .set({ workingOn: null, updatedAt: now() })
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
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
        conditions.push(sql`LOWER(${tasks.status}) NOT IN ('done', 'cancelled')`);
      }
      if (title) {
        const orConditions = [
          like(tasks.title, `%${title}%`),
          like(tasks.jiraKey, `%${title}%`),
          like(tasks.headBranch, `%${title}%`),
        ];
        const parsed = Number(title);
        if (Number.isInteger(parsed) && parsed > 0) {
          orConditions.push(eq(tasks.id, parsed));
        }
        conditions.push(or(...orConditions));
      }
      const whereCondition = and(...conditions);

      // Get paginated completed tasks
      const taskList = await db
        .select()
        .from(tasks)
        .where(whereCondition)
        .orderBy(await getStatusOrderExprAsync())
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

  // Get non-completed linked tasks for curation view
  "/api/v1/tasks/with-relations": {
    async GET() {
      // Get all non-completed linked tasks (manual OR merged)
      const taskList = await db
        .select()
        .from(tasks)
        .where(
          and(
            await getNotCompletedCondition(),
            or(
              // Manual tasks
              and(isNull(tasks.jiraKey), isNull(tasks.prNumber)),
              // Merged tasks
              and(isNotNull(tasks.jiraKey), isNotNull(tasks.prNumber))
            )
          )
        )
        .orderBy(await getStatusOrderExprAsync());

      const repoMap = await buildRepoMap(taskList);

      const items = taskList.map((task) => ({
        ...task,
        repository: task.repositoryId ? repoMap.get(task.repositoryId) || null : null,
      }));

      return json({ items, total: items.length });
    },
  },

  // Get Jira orphans (jiraKey set, no prNumber, not completed)
  "/api/v1/tasks/orphan-jira": {
    async GET() {
      const items = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.jiraKey),
            isNull(tasks.prNumber),
            await getNotCompletedCondition()
          )
        )
        .orderBy(await getStatusOrderExprAsync());

      return json({ items, total: items.length });
    },
  },

  // Get PR orphans (prNumber set, no jiraKey, not merged)
  "/api/v1/tasks/orphan-pr": {
    async GET() {
      const taskList = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.prNumber),
            isNull(tasks.jiraKey),
            // Exclude merged and closed PRs
            or(
              isNull(tasks.prState),
              and(ne(tasks.prState, "merged"), ne(tasks.prState, "closed"))
            )
          )
        )
        .orderBy(await getStatusOrderExprAsync());

      const repoMap = await buildRepoMap(taskList);

      const items = taskList.map((task) => ({
        ...task,
        repository: task.repositoryId ? repoMap.get(task.repositoryId) || null : null,
      }));

      return json({ items, total: items.length });
    },
  },

  // Get task by Jira key
  "/api/v1/tasks/by-jira-key/:key": {
    async GET(req, params) {
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
    async GET(req, params) {
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
