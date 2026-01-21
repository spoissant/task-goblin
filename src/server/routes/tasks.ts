import { eq, and, sql, ne, isNull, isNotNull, or, desc } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, blockedBy, repositories, logs } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import {
  VALID_STATUSES,
  jiraStatusNotInCondition,
  getCompletedCondition,
  getNotCompletedCondition,
  statusOrderExpr,
} from "../lib/task-status";
import type { Routes } from "../router";

export const taskRoutes: Routes = {
  "/api/v1/tasks": {
    async GET(req) {
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      const blocked = url.searchParams.get("blocked");
      const orphanJira = url.searchParams.get("orphanJira");
      const orphanPr = url.searchParams.get("orphanPr");
      const linked = url.searchParams.get("linked");
      const excludeCompleted = url.searchParams.get("excludeCompleted") !== "false"; // default true
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");

      const conditions = [];

      // Exclude completed tasks by default
      if (excludeCompleted) {
        conditions.push(getNotCompletedCondition());
      }

      if (status) {
        conditions.push(eq(tasks.status, status));
      }

      if (blocked === "true") {
        conditions.push(
          sql`${tasks.id} IN (SELECT blocked_task_id FROM blocked_by WHERE blocked_task_id IS NOT NULL)`
        );
      } else if (blocked === "false") {
        conditions.push(
          sql`${tasks.id} NOT IN (SELECT blocked_task_id FROM blocked_by WHERE blocked_task_id IS NOT NULL)`
        );
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

      query = query.orderBy(statusOrderExpr) as typeof query;

      // Apply pagination if specified
      if (limit) {
        query = query.limit(parseInt(limit, 10)) as typeof query;
      }
      if (offset) {
        query = query.offset(parseInt(offset, 10)) as typeof query;
      }

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

      // Get unread log counts for each task
      const unreadLogCountsMap = new Map<number, number>();
      if (taskIds.length > 0) {
        const unreadLogCounts = await db
          .select({
            taskId: logs.taskId,
            count: sql<number>`count(*)`,
          })
          .from(logs)
          .where(
            and(
              sql`${logs.taskId} IN (${sql.join(taskIds.map(id => sql`${id}`), sql`, `)})`,
              isNull(logs.readAt)
            )
          )
          .groupBy(logs.taskId);

        for (const row of unreadLogCounts) {
          if (row.taskId) {
            unreadLogCountsMap.set(row.taskId, row.count);
          }
        }
      }

      const items = taskList.map((task) => ({
        ...task,
        pendingTodos: pendingTodosMap.get(task.id) || [],
        unreadLogCount: unreadLogCountsMap.get(task.id) || 0,
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

      if (body.status && !VALID_STATUSES.includes(body.status)) {
        throw new ValidationError(
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const timestamp = now();
      const result = await db
        .insert(tasks)
        .values({
          title: body.title,
          description: body.description || null,
          status: body.status || "todo",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/tasks/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db.select().from(tasks).where(eq(tasks.id, id));

      if (result.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const task = result[0];

      // Get related entities
      const taskTodos = await db
        .select()
        .from(todos)
        .where(eq(todos.taskId, id));

      const taskBlockedBy = await db
        .select()
        .from(blockedBy)
        .where(eq(blockedBy.blockedTaskId, id));

      // Get repository if task has one
      let repository = null;
      if (task.repositoryId) {
        const repoResult = await db
          .select()
          .from(repositories)
          .where(eq(repositories.id, task.repositoryId));
        repository = repoResult[0] || null;
      }

      // Get logs for this task
      const taskLogs = await db
        .select()
        .from(logs)
        .where(eq(logs.taskId, id))
        .orderBy(desc(logs.createdAt));

      return json({
        ...task,
        todos: taskTodos,
        blockedBy: taskBlockedBy,
        repository,
        logs: taskLogs,
      });
    },

    async PUT(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      if (body.status && !VALID_STATUSES.includes(body.status)) {
        throw new ValidationError(
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const result = await db
        .update(tasks)
        .set({
          title: body.title,
          description: body.description ?? null,
          status: body.status || existing[0].status,
          updatedAt: now(),
        })
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (body.status && !VALID_STATUSES.includes(body.status)) {
        throw new ValidationError(
          `status must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.status !== undefined) updates.status = body.status;

      const result = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      // Cascade delete: blockedBy, todos
      await db
        .delete(blockedBy)
        .where(eq(blockedBy.blockedTaskId, id));
      await db
        .delete(todos)
        .where(eq(todos.taskId, id));

      await db.delete(tasks).where(eq(tasks.id, id));

      return noContent();
    },
  },

  // Get completed tasks with pagination
  "/api/v1/tasks/completed": {
    async GET(req) {
      const url = new URL(req.url);
      const limit = parseInt(url.searchParams.get("limit") || "25", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      const completedCondition = getCompletedCondition();

      // Get paginated completed tasks
      const taskList = await db
        .select()
        .from(tasks)
        .where(completedCondition)
        .orderBy(statusOrderExpr)
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(completedCondition);
      const total = totalResult[0]?.count ?? 0;

      // Get repositories for tasks that have one
      const repoIds = [...new Set(taskList.filter(t => t.repositoryId).map(t => t.repositoryId!))];
      const repoMap = new Map<number, typeof repositories.$inferSelect>();

      if (repoIds.length > 0) {
        const repos = await db
          .select()
          .from(repositories)
          .where(sql`${repositories.id} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`);
        for (const repo of repos) {
          repoMap.set(repo.id, repo);
        }
      }

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
            getNotCompletedCondition(),
            or(
              // Manual tasks
              and(isNull(tasks.jiraKey), isNull(tasks.prNumber)),
              // Merged tasks
              and(isNotNull(tasks.jiraKey), isNotNull(tasks.prNumber))
            )
          )
        )
        .orderBy(statusOrderExpr);

      // Get repositories for all tasks that have one
      const repoIds = [...new Set(taskList.filter(t => t.repositoryId).map(t => t.repositoryId!))];
      const repoMap = new Map<number, typeof repositories.$inferSelect>();

      if (repoIds.length > 0) {
        const repos = await db
          .select()
          .from(repositories)
          .where(sql`${repositories.id} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`);
        for (const repo of repos) {
          repoMap.set(repo.id, repo);
        }
      }

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
            // Exclude Jira-completed statuses
            jiraStatusNotInCondition()
          )
        )
        .orderBy(statusOrderExpr);

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
            // Exclude merged PRs
            or(isNull(tasks.prState), ne(tasks.prState, "merged"))
          )
        )
        .orderBy(statusOrderExpr);

      // Get repositories
      const repoIds = [...new Set(taskList.filter(t => t.repositoryId).map(t => t.repositoryId!))];
      const repoMap = new Map<number, typeof repositories.$inferSelect>();

      if (repoIds.length > 0) {
        const repos = await db
          .select()
          .from(repositories)
          .where(sql`${repositories.id} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`);
        for (const repo of repos) {
          repoMap.set(repo.id, repo);
        }
      }

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
};
