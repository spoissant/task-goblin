import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  get,
  patch,
  post,
  resolveTaskId,
  type TaskWithRelations,
} from "../client.js";

export function registerTaskTools(server: McpServer) {
  // get_task
  server.registerTool(
    "get_task",
    {
      description:
        "Get a single task by ID, Jira key, PR number, or branch name. Returns task with todos and blockers.",
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
        notes: z.string().optional().describe("Task notes (markdown)"),
        instructions: z.string().optional().describe("Implementation instructions (markdown)"),
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
    async ({ id, jiraKey, prNumber, repo, branch, title, description, status, notes, instructions, blockedBy }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });

        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;
        if (notes !== undefined) updates.notes = notes;
        if (instructions !== undefined) updates.instructions = instructions;

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
}
