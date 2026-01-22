import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  get,
  post,
  patch,
  resolveTaskId,
  type Task,
  type TaskWithRelations,
  type ListResponse,
  type SyncResult,
  type SplitResult,
} from "../client.js";

export function registerTaskTools(server: McpServer) {
  // list_tasks
  server.registerTool(
    "list_tasks",
    {
      description: "List all tasks with optional filters. Can filter by status, orphan type (jira-only or pr-only tasks), or linked (both jira and pr).",
      inputSchema: {
        status: z.string().optional().describe("Filter by status (todo, in_progress, code_review, qa, done, blocked, ready_to_merge)"),
        orphanJira: z.boolean().optional().describe("If true, return only Jira orphan tasks (have jiraKey but no prNumber)"),
        orphanPr: z.boolean().optional().describe("If true, return only PR orphan tasks (have prNumber but no jiraKey)"),
        linked: z.boolean().optional().describe("If true, return only linked tasks (have both jiraKey and prNumber, or manual tasks)"),
      },
    },
    async ({ status, orphanJira, orphanPr, linked }) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (orphanJira) params.set("orphanJira", "true");
      if (orphanPr) params.set("orphanPr", "true");
      if (linked) params.set("linked", "true");
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
      description: "Get a single task by ID or Jira key. Returns task with todos and blockers.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
      },
    },
    async ({ id, jiraKey }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey });
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
      description: "Create a new manual task",
      inputSchema: {
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description"),
        status: z.string().optional().describe("Task status (default: todo)"),
      },
    },
    async ({ title, description, status }) => {
      try {
        const task = await post<Task>("/api/v1/tasks", {
          title,
          description,
          status: status || "todo",
        });

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
      description: "Update an existing task by ID or Jira key",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        title: z.string().optional().describe("New task title"),
        description: z.string().optional().describe("New task description"),
        status: z.string().optional().describe("New task status"),
        blockedBy: z
          .array(
            z.object({
              taskId: z.number().optional(),
              todoId: z.number().optional(),
            })
          )
          .optional()
          .describe("Array of blockers to add (each must have exactly one of taskId or todoId)"),
      },
    },
    async ({ id, jiraKey, title, description, status, blockedBy }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey });

        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;

        if (Object.keys(updates).length > 0) {
          await patch(`/api/v1/tasks/${taskId}`, updates);
        }

        if (blockedBy && blockedBy.length > 0) {
          for (const blocker of blockedBy) {
            await post("/api/v1/blocked-by", {
              blockedTaskId: taskId,
              blockerTaskId: blocker.taskId || null,
              blockerTodoId: blocker.todoId || null,
            });
          }
        }

        const fullTask = await get<TaskWithRelations>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(fullTask) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // merge_tasks
  server.registerTool(
    "merge_tasks",
    {
      description: "Merge two orphan tasks (one Jira, one PR) into a single linked task. The target task receives fields from the source, and the source is deleted.",
      inputSchema: {
        targetId: z.number().describe("ID of the target task (will be kept)"),
        sourceId: z.number().describe("ID of the source task (will be deleted after merge)"),
      },
    },
    async ({ targetId, sourceId }) => {
      try {
        const result = await post<Task>(`/api/v1/tasks/${targetId}/merge`, { sourceTaskId: sourceId });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // split_task
  server.registerTool(
    "split_task",
    {
      description: "Split a merged task back into two orphan tasks. Creates a new PR orphan task from the PR fields and clears PR fields from the original.",
      inputSchema: {
        id: z.number().describe("ID of the merged task to split"),
      },
    },
    async ({ id }) => {
      try {
        const result = await post<SplitResult>(`/api/v1/tasks/${id}/split`);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // sync_jira
  server.registerTool(
    "sync_jira",
    {
      description: "Sync tasks from Jira API",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await post<SyncResult>("/api/v1/sync/jira");
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // sync_github
  server.registerTool(
    "sync_github",
    {
      description: "Sync tasks from GitHub API. Automatically merges matching Jira/PR orphans based on Jira keys in branch names or PR titles.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await post<SyncResult>("/api/v1/sync/github");
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
