import { eq, and, sql, ne, isNull, isNotNull, or, desc, like } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, repositories, logs, noteTasks, notes } from "../../db/schema";
import { buildRepoMap } from "../lib/queries";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId, validatePagination } from "../lib/validation";
import {
  jiraStatusNotInCondition,
  getCompletedCondition,
  getNotCompletedCondition,
  statusOrderExpr,
  isStatusSelectable,
  getSelectableStatuses,
} from "../lib/task-status";
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
        conditions.push(getNotCompletedCondition());
      }

      if (status) {
        conditions.push(eq(tasks.status, status));
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
        conditions.push(like(tasks.title, `%${title}%`));
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

      query = query.orderBy(statusOrderExpr) as typeof query;

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

      // Validate status against selectable statuses
      if (body.status) {
        const isValid = await isStatusSelectable(body.status);
        if (!isValid) {
          const selectableStatuses = await getSelectableStatuses();
          throw new ValidationError(
            `Manual task status must be one of: ${selectableStatuses.map(s => s.name).join(", ")}`
          );
        }
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
        logs: taskLogs,
        notes: linkedNotes,
      });
    },

    async PUT(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      // Validate status against selectable statuses
      if (body.status) {
        const isValid = await isStatusSelectable(body.status);
        if (!isValid) {
          const selectableStatuses = await getSelectableStatuses();
          throw new ValidationError(
            `Manual task status must be one of: ${selectableStatuses.map(s => s.name).join(", ")}`
          );
        }
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
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      // Validate status against selectable statuses
      if (body.status) {
        // Reject status changes for Jira-linked tasks
        if (existing[0].jiraKey) {
          throw new ValidationError("Cannot change status of Jira-linked task");
        }

        const isValid = await isStatusSelectable(body.status);
        if (!isValid) {
          const selectableStatuses = await getSelectableStatuses();
          throw new ValidationError(
            `Manual task status must be one of: ${selectableStatuses.map(s => s.name).join(", ")}`
          );
        }
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      // Use 'in' operator to allow explicitly setting fields to null
      if ("title" in body) updates.title = body.title;
      if ("description" in body) updates.description = body.description;
      if ("status" in body) updates.status = body.status;

      const result = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      // Cascade delete: todos
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
      const { limit, offset } = validatePagination(
        url.searchParams.get("limit") || "25",
        url.searchParams.get("offset")
      );
      const showDone = url.searchParams.get("showDone") === "true";
      const title = url.searchParams.get("title");

      const conditions = [getCompletedCondition()];
      if (!showDone) {
        conditions.push(sql`LOWER(${tasks.status}) NOT IN ('done', 'cancelled')`);
      }
      if (title) {
        conditions.push(like(tasks.title, `%${title}%`));
      }
      const whereCondition = and(...conditions);

      // Get paginated completed tasks
      const taskList = await db
        .select()
        .from(tasks)
        .where(whereCondition)
        .orderBy(statusOrderExpr)
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
            // Exclude merged and closed PRs
            or(
              isNull(tasks.prState),
              and(ne(tasks.prState, "merged"), ne(tasks.prState, "closed"))
            )
          )
        )
        .orderBy(statusOrderExpr);

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
