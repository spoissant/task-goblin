import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  get,
  post,
  patch,
  resolveTaskId,
  type TaskWithRelations,
  type ListResponse,
  type Task,
} from "../client.js";

export function registerTaskTools(server: McpServer) {
  // get_task
  server.registerTool(
    "get_task",
    {
      description:
        "Get a single task by ID, Jira key, PR number, or branch name. Returns task with todos.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("GitHub PR number"),
        repo: z
          .string()
          .optional()
          .describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
        branch: z.string().optional().describe("Git branch name (headBranch)"),
      },
    },
    async ({ id, jiraKey, prNumber, repo, branch }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });
        const task = await get<TaskWithRelations>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // list_tasks
  server.registerTool(
    "list_tasks",
    {
      description:
        "List tasks with optional filters. Returns paginated results.",
      inputSchema: {
        status: z.string().optional().describe("Filter by status name"),
        title: z.string().optional().describe("Substring search on title, Jira key, or branch name"),
        completed: z.boolean().optional().describe("When true, fetch completed tasks instead"),
        checks: z.enum(["passing", "failing"]).optional().describe("Filter by CI checks status"),
        maxReviews: z.number().int().optional().describe("Tasks with fewer than N approved reviews"),
        hasComments: z.boolean().optional().describe("Filter by unresolved comments presence"),
        limit: z.number().int().optional().default(25).describe("Page size (default 25)"),
        offset: z.number().int().optional().default(0).describe("Offset for pagination"),
      },
    },
    async ({ status, title, completed, checks, maxReviews, hasComments, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (title) params.set("title", title);
        if (checks) params.set("checks", checks);
        if (maxReviews !== undefined) params.set("maxReviews", String(maxReviews));
        if (hasComments !== undefined) params.set("hasComments", String(hasComments));
        if (limit !== undefined) params.set("limit", String(limit));
        if (offset !== undefined) params.set("offset", String(offset));

        const base = completed ? "/api/v1/tasks/completed" : "/api/v1/tasks";
        const qs = params.toString();
        const path = qs ? `${base}?${qs}` : base;

        const data = await get<ListResponse<Task>>(path);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
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
      description: "Create a task from a GitHub PR. Syncs the PR from GitHub and returns the created or updated task.",
      inputSchema: {
        owner: z.string().describe("GitHub repo owner (user or org)"),
        repo: z.string().describe("GitHub repo name"),
        prNumber: z.number().int().describe("GitHub PR number"),
      },
    },
    async ({ owner, repo, prNumber }) => {
      try {
        await post(`/api/v1/sync/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${prNumber}`);
        const task = await get<TaskWithRelations>(
          `/api/v1/tasks/by-pr/${prNumber}?repo=${encodeURIComponent(`${owner}/${repo}`)}`
        );
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
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
      description: "Update an existing task by ID, Jira key, PR number, or branch name",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("GitHub PR number"),
        repo: z
          .string()
          .optional()
          .describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
        branch: z.string().optional().describe("Git branch name (headBranch)"),
        title: z.string().optional().describe("New task title"),
        description: z.string().optional().describe("New task description"),
        status: z.string().optional().describe("New task status"),
      },
    },
    async ({ id, jiraKey, prNumber, repo, branch, title, description, status }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });

        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;

        if (Object.keys(updates).length > 0) {
          await patch(`/api/v1/tasks/${taskId}`, updates);
        }

        const fullTask = await get<TaskWithRelations>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(fullTask) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
