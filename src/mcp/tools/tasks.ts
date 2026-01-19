import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  get,
  post,
  patch,
  getOrSyncJira,
  getOrSyncPR,
  resolveTaskId,
  type Task,
  type TaskWithRelations,
  type ListResponse,
} from "../client.js";

export function registerTaskTools(server: McpServer) {
  // list_tasks
  server.registerTool(
    "list_tasks",
    {
      description: "List all tasks with optional filters",
      inputSchema: {
        status: z.string().optional().describe("Filter by status (todo, in_progress, code_review, qa, done, blocked)"),
        blocked: z.boolean().optional().describe("Filter by blocked state"),
        jiraKey: z.string().optional().describe("Filter by linked Jira key"),
        prNumber: z.number().optional().describe("Filter by linked PR number"),
        prRepo: z.string().optional().describe("Repository for PR filter (owner/repo format)"),
      },
    },
    async ({ status, blocked, jiraKey, prNumber, prRepo }) => {
      // Handle jiraKey filter - find task through Jira item
      if (jiraKey) {
        try {
          const jiraItem = await getOrSyncJira(jiraKey);
          if (!jiraItem.taskId) {
            return { content: [{ type: "text", text: JSON.stringify({ items: [], total: 0 }) }] };
          }
          const task = await get<TaskWithRelations>(`/api/v1/tasks/${jiraItem.taskId}`);
          return { content: [{ type: "text", text: JSON.stringify({ items: [task], total: 1 }) }] };
        } catch {
          return { content: [{ type: "text", text: JSON.stringify({ items: [], total: 0 }) }] };
        }
      }

      // Handle prNumber+prRepo filter - find task through PR's branch
      if (prNumber && prRepo) {
        const [owner, repo] = prRepo.split("/");
        if (!owner || !repo) {
          return { content: [{ type: "text", text: "Error: prRepo must be in format 'owner/repo'" }], isError: true };
        }
        try {
          const pr = await getOrSyncPR(owner, repo, prNumber);
          if (!pr.branches || pr.branches.length === 0 || !pr.branches[0].taskId) {
            return { content: [{ type: "text", text: JSON.stringify({ items: [], total: 0 }) }] };
          }
          const task = await get<TaskWithRelations>(`/api/v1/tasks/${pr.branches[0].taskId}`);
          return { content: [{ type: "text", text: JSON.stringify({ items: [task], total: 1 }) }] };
        } catch {
          return { content: [{ type: "text", text: JSON.stringify({ items: [], total: 0 }) }] };
        }
      }

      // Standard API filter
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (blocked !== undefined) params.set("blocked", String(blocked));
      const queryString = params.toString();
      const path = `/api/v1/tasks${queryString ? `?${queryString}` : ""}`;

      const result = await get<ListResponse<Task>>(path);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // get_task
  server.registerTool(
    "get_task",
    {
      description: "Get a single task by ID, Jira key, or PR number. Returns task with todos, branches, Jira items, and blockers.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("PR number to look up task"),
        prRepo: z.string().optional().describe("Repository for PR lookup (owner/repo format)"),
      },
    },
    async ({ id, jiraKey, prNumber, prRepo }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, prRepo });
        const task = await get<TaskWithRelations>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // create_task
  server.registerTool(
    "create_task",
    {
      description: "Create a new task, optionally linking it to a Jira issue or GitHub PR",
      inputSchema: {
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description"),
        status: z.string().optional().describe("Task status (default: todo)"),
        jiraKey: z.string().optional().describe("Jira key to link to the new task"),
        prNumber: z.number().optional().describe("PR number to link to the new task"),
        prRepo: z.string().optional().describe("Repository for PR (owner/repo format)"),
      },
    },
    async ({ title, description, status, jiraKey, prNumber, prRepo }) => {
      try {
        // Create the task
        const task = await post<Task>("/api/v1/tasks", {
          title,
          description,
          status: status || "todo",
        });

        // Link to Jira if provided
        if (jiraKey) {
          const jiraItem = await getOrSyncJira(jiraKey);
          await post(`/api/v1/jira/items/${jiraItem.id}/link`, { taskId: task.id });
        }

        // Link to PR if provided
        if (prNumber && prRepo) {
          const [owner, repo] = prRepo.split("/");
          if (!owner || !repo) {
            return { content: [{ type: "text", text: "Error: prRepo must be in format 'owner/repo'" }], isError: true };
          }
          const pr = await getOrSyncPR(owner, repo, prNumber);
          // Create a branch linking the task and PR
          await post("/api/v1/branches", {
            name: pr.headBranch,
            repositoryId: pr.repositoryId,
            taskId: task.id,
            pullRequestId: pr.id,
          });
        }

        // Return the full task with relations
        const fullTask = await get<TaskWithRelations>(`/api/v1/tasks/${task.id}`);
        return { content: [{ type: "text", text: JSON.stringify(fullTask) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // update_task
  server.registerTool(
    "update_task",
    {
      description: "Update an existing task by ID, Jira key, or PR number",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("PR number to look up task"),
        prRepo: z.string().optional().describe("Repository for PR lookup (owner/repo format)"),
        title: z.string().optional().describe("New task title"),
        description: z.string().optional().describe("New task description"),
        status: z.string().optional().describe("New task status"),
        blockedBy: z
          .array(
            z.object({
              taskId: z.number().optional(),
              todoId: z.number().optional(),
              branchId: z.number().optional(),
            })
          )
          .optional()
          .describe("Array of blockers to add (each must have exactly one of taskId, todoId, or branchId)"),
      },
    },
    async ({ id, jiraKey, prNumber, prRepo, title, description, status, blockedBy }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, prRepo });

        // Build update payload
        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          await patch(`/api/v1/tasks/${taskId}`, updates);
        }

        // Add blockedBy relations
        if (blockedBy && blockedBy.length > 0) {
          for (const blocker of blockedBy) {
            await post("/api/v1/blocked-by", {
              blockedTaskId: taskId,
              blockerTaskId: blocker.taskId || null,
              blockerTodoId: blocker.todoId || null,
              blockerBranchId: blocker.branchId || null,
            });
          }
        }

        // Return the updated task with relations
        const fullTask = await get<TaskWithRelations>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(fullTask) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
