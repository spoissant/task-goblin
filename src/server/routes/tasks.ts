import { eq, and, sql, ne, isNull, isNotNull, or, desc } from "drizzle-orm";
import { db } from "../../db";
import { tasks, todos, blockedBy, repositories, logs } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

const VALID_STATUSES = ["todo", "in_progress", "code_review", "qa", "done", "blocked"];

// Jira statuses that indicate completion (case-insensitive)
const JIRA_COMPLETED_STATUSES = [
  "ready to prod",
  "completed",
  "done",
  "closed",
  "cancelled",
  "rejected",
  "define preventive measures",
];

// SQL condition for checking if a task is completed based on its type
function getCompletedCondition() {
  const jiraStatusList = JIRA_COMPLETED_STATUSES.map((s) => `'${s}'`).join(", ");

  return or(
    // Jira-only completed: jiraKey set, no prNumber, status in completed list
    and(
      isNotNull(tasks.jiraKey),
      isNull(tasks.prNumber),
      sql`LOWER(${tasks.status}) IN (${sql.raw(jiraStatusList)})`
    ),
    // PR-only completed: prNumber set, no jiraKey, prState = merged
    and(
      isNotNull(tasks.prNumber),
      isNull(tasks.jiraKey),
      eq(tasks.prState, "merged")
    ),
    // Both completed: jiraKey AND prNumber set, both conditions met
    and(
      isNotNull(tasks.jiraKey),
      isNotNull(tasks.prNumber),
      sql`LOWER(${tasks.status}) IN (${sql.raw(jiraStatusList)})`,
      eq(tasks.prState, "merged")
    ),
    // Manual completed: no jiraKey, no prNumber, status = done
    and(
      isNull(tasks.jiraKey),
      isNull(tasks.prNumber),
      eq(tasks.status, "done")
    )
  );
}

// SQL condition for non-completed tasks (inverse of completed)
function getNotCompletedCondition() {
  return sql`NOT (${getCompletedCondition()})`;
}

// SQL CASE expression for status ordering (lower = higher priority)
// Handles both underscore and space variants (e.g., "code_review" and "code review")
const statusOrderExpr = sql`CASE
  WHEN LOWER(${tasks.status}) = 'done' THEN 0
  WHEN LOWER(${tasks.status}) = 'cancelled' THEN 1
  WHEN LOWER(${tasks.status}) = 'rejected' THEN 2
  WHEN LOWER(${tasks.status}) = 'closed' THEN 3
  WHEN LOWER(${tasks.status}) IN ('ready to prod', 'ready_to_prod') THEN 4
  WHEN LOWER(${tasks.status}) IN ('ready to merge', 'ready_to_merge') THEN 5
  WHEN LOWER(${tasks.status}) = 'qa' THEN 6
  WHEN LOWER(${tasks.status}) IN ('ready for test', 'ready_for_test') THEN 7
  WHEN LOWER(${tasks.status}) IN ('code review', 'code_review') THEN 8
  WHEN LOWER(${tasks.status}) IN ('in progress', 'in_progress') THEN 9
  WHEN LOWER(${tasks.status}) IN ('to do', 'todo') THEN 10
  WHEN LOWER(${tasks.status}) = 'accepted' THEN 11
  WHEN LOWER(${tasks.status}) = 'backlog' THEN 12
  WHEN LOWER(${tasks.status}) IN ('on hold', 'on_hold') THEN 13
  ELSE 14
END`;

async function getBody(req: Request) {
  return req.json();
}

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

      // Get next todo (lowest position incomplete) for each task
      const taskIds = taskList.map((t) => t.id);
      const nextTodoMap = new Map<number, { id: number; content: string; position: number | null }>();

      if (taskIds.length > 0) {
        // Get the lowest position incomplete todo for each task
        const nextTodos = await db
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

        // Keep only the first (lowest position) incomplete todo per task
        for (const todo of nextTodos) {
          if (todo.taskId && !nextTodoMap.has(todo.taskId)) {
            nextTodoMap.set(todo.taskId, { id: todo.id, content: todo.content, position: todo.position });
          }
        }
      }

      const items = taskList.map((task) => ({
        ...task,
        nextTodo: nextTodoMap.get(task.id) || null,
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
      const jiraStatusList = JIRA_COMPLETED_STATUSES.map((s) => `'${s}'`).join(", ");

      const items = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.jiraKey),
            isNull(tasks.prNumber),
            // Exclude Jira-completed statuses
            sql`LOWER(${tasks.status}) NOT IN (${sql.raw(jiraStatusList)})`
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

  // Merge two orphan tasks (jira + pr) into one
  "/api/v1/tasks/:id/merge": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);
      const body = await getBody(req);

      if (!body.sourceTaskId || typeof body.sourceTaskId !== "number") {
        throw new ValidationError("sourceTaskId is required");
      }

      const targetTask = await db.select().from(tasks).where(eq(tasks.id, id));
      if (targetTask.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const sourceTask = await db.select().from(tasks).where(eq(tasks.id, body.sourceTaskId));
      if (sourceTask.length === 0) {
        throw new NotFoundError("Task", body.sourceTaskId);
      }

      const target = targetTask[0];
      const source = sourceTask[0];

      // Determine which has Jira and which has PR
      const jiraTask = target.jiraKey ? target : source.jiraKey ? source : null;
      const prTask = target.prNumber ? target : source.prNumber ? source : null;

      if (!jiraTask || !prTask) {
        throw new ValidationError("One task must have jiraKey and the other must have prNumber");
      }

      if (jiraTask.id === prTask.id) {
        throw new ValidationError("Cannot merge a task with itself");
      }

      // Merge: copy fields from source to target
      const mergedFields: Record<string, unknown> = { updatedAt: now() };

      // If target is Jira task, copy PR fields from source
      if (target.jiraKey && !target.prNumber) {
        mergedFields.prNumber = prTask.prNumber;
        mergedFields.repositoryId = prTask.repositoryId;
        mergedFields.headBranch = prTask.headBranch;
        mergedFields.baseBranch = prTask.baseBranch;
        mergedFields.prState = prTask.prState;
        mergedFields.prAuthor = prTask.prAuthor;
        mergedFields.isDraft = prTask.isDraft;
        mergedFields.checksStatus = prTask.checksStatus;
        mergedFields.checksDetails = prTask.checksDetails;
        mergedFields.approvedReviewCount = prTask.approvedReviewCount;
        mergedFields.unresolvedCommentCount = prTask.unresolvedCommentCount;
        mergedFields.reviewStatus = prTask.reviewStatus;
        mergedFields.prSyncedAt = prTask.prSyncedAt;
      }
      // If target is PR task, copy Jira fields from source
      else if (target.prNumber && !target.jiraKey) {
        mergedFields.jiraKey = jiraTask.jiraKey;
        mergedFields.type = jiraTask.type;
        mergedFields.assignee = jiraTask.assignee;
        mergedFields.priority = jiraTask.priority;
        mergedFields.sprint = jiraTask.sprint;
        mergedFields.epicKey = jiraTask.epicKey;
        mergedFields.lastComment = jiraTask.lastComment;
        mergedFields.jiraSyncedAt = jiraTask.jiraSyncedAt;
        // Use Jira summary as title if target doesn't have a good title
        if (jiraTask.title && jiraTask.title !== prTask.headBranch) {
          mergedFields.title = jiraTask.title;
        }
        if (jiraTask.description) {
          mergedFields.description = jiraTask.description;
        }
      }

      // Update target with merged fields
      const result = await db
        .update(tasks)
        .set(mergedFields)
        .where(eq(tasks.id, id))
        .returning();

      // Move todos from source to target
      await db
        .update(todos)
        .set({ taskId: id })
        .where(eq(todos.taskId, body.sourceTaskId));

      // Move blockedBy relations from source to target
      await db
        .update(blockedBy)
        .set({ blockedTaskId: id })
        .where(eq(blockedBy.blockedTaskId, body.sourceTaskId));

      // Delete source task
      await db.delete(tasks).where(eq(tasks.id, body.sourceTaskId));

      return json(result[0]);
    },
  },

  // Split a merged task back into two orphans
  "/api/v1/tasks/:id/split": {
    async POST(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db.select().from(tasks).where(eq(tasks.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("Task", id);
      }

      const task = existing[0];

      // Must be a merged task (both jiraKey and prNumber)
      if (!task.jiraKey || !task.prNumber) {
        throw new ValidationError("Task must have both jiraKey and prNumber to split");
      }

      const timestamp = now();

      // Create new PR orphan task with PR fields
      const newPrTask = await db
        .insert(tasks)
        .values({
          title: task.headBranch || `PR #${task.prNumber}`,
          description: null,
          status: task.status,
          prNumber: task.prNumber,
          repositoryId: task.repositoryId,
          headBranch: task.headBranch,
          baseBranch: task.baseBranch,
          prState: task.prState,
          prAuthor: task.prAuthor,
          isDraft: task.isDraft,
          checksStatus: task.checksStatus,
          reviewStatus: task.reviewStatus,
          unresolvedCommentCount: task.unresolvedCommentCount,
          prSyncedAt: task.prSyncedAt,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      // Clear PR fields from original task (keep as Jira orphan)
      const result = await db
        .update(tasks)
        .set({
          prNumber: null,
          repositoryId: null,
          headBranch: null,
          baseBranch: null,
          prState: null,
          prAuthor: null,
          isDraft: null,
          checksStatus: null,
          reviewStatus: null,
          unresolvedCommentCount: null,
          prSyncedAt: null,
          updatedAt: timestamp,
        })
        .where(eq(tasks.id, id))
        .returning();

      return json({
        jiraTask: result[0],
        prTask: newPrTask[0],
      });
    },
  },

  // Auto-match orphans by finding jiraKey in branch names/titles
  "/api/v1/tasks/auto-match": {
    async POST() {
      const jiraStatusList = JIRA_COMPLETED_STATUSES.map((s) => `'${s}'`).join(", ");

      // Get all non-completed Jira orphans
      const jiraOrphans = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.jiraKey),
            isNull(tasks.prNumber),
            sql`LOWER(${tasks.status}) NOT IN (${sql.raw(jiraStatusList)})`
          )
        );

      // Get all non-merged PR orphans
      const prOrphans = await db
        .select()
        .from(tasks)
        .where(
          and(
            isNotNull(tasks.prNumber),
            isNull(tasks.jiraKey),
            or(isNull(tasks.prState), ne(tasks.prState, "merged"))
          )
        );

      const matches: Array<{ jiraTaskId: number; prTaskId: number; jiraKey: string }> = [];

      // For each PR orphan, try to find matching Jira key in branch name or title
      for (const prTask of prOrphans) {
        const searchText = `${prTask.headBranch || ""} ${prTask.title || ""}`.toUpperCase();

        for (const jiraTask of jiraOrphans) {
          if (!jiraTask.jiraKey) continue;

          // Check if jira key appears in the PR's branch or title
          if (searchText.includes(jiraTask.jiraKey.toUpperCase())) {
            matches.push({
              jiraTaskId: jiraTask.id,
              prTaskId: prTask.id,
              jiraKey: jiraTask.jiraKey,
            });
            break; // Only one match per PR
          }
        }
      }

      return json({ matches, total: matches.length });
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
