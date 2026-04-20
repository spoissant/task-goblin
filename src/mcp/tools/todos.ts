import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, post, patch, del, type Todo, type ListResponse } from "../client.js";

export function registerTodoTools(server: McpServer) {
  // list_todos
  server.registerTool(
    "list_todos",
    {
      description: "List todos with optional filters",
      inputSchema: {
        taskId: z.number().optional().describe("Filter by parent task ID"),
        done: z.boolean().optional().describe("Filter by completion status"),
        isCustomChore: z.boolean().optional().describe("Filter by custom chore flag"),
      },
    },
    async ({ taskId, done, isCustomChore }) => {
      const params = new URLSearchParams();
      if (taskId !== undefined) params.set("taskId", String(taskId));
      if (done !== undefined) params.set("done", String(done));
      if (isCustomChore !== undefined) params.set("isCustomChore", String(isCustomChore));

      const queryString = params.toString();
      const path = `/api/v1/todos${queryString ? `?${queryString}` : ""}`;

      const result = await get<ListResponse<Todo>>(path);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // create_todo
  server.registerTool(
    "create_todo",
    {
      description: "Create a new todo item. For custom chores, set isCustomChore=true and provide choreRank and chorePrompt.",
      inputSchema: {
        content: z.string().describe("Todo content/name. For custom chores, this is the chore display name."),
        taskId: z.number().optional().describe("Parent task ID (required for custom chores)"),
        placement: z.enum(["top", "bottom"]).optional().describe("Where to insert the todo (default: bottom)"),
        isCustomChore: z.boolean().optional().describe("Set to true to create a custom chore"),
        choreRank: z.number().int().optional().describe("Chore definition number this runs before (e.g. 5 = runs before chore #5 'Request Reviews'). Required when isCustomChore=true."),
        chorePrompt: z.string().optional().describe("The custom action/prompt to execute. Required when isCustomChore=true."),
      },
    },
    async ({ content, taskId, placement, isCustomChore, choreRank, chorePrompt }) => {
      try {
        const placementMapped = placement === "top" ? "start" : placement === "bottom" ? "end" : undefined;
        const todo = await post<Todo>("/api/v1/todos", {
          content,
          taskId: taskId || null,
          placement: placementMapped,
          isCustomChore: isCustomChore ?? false,
          choreRank: choreRank ?? null,
          chorePrompt: chorePrompt ?? null,
        });
        return { content: [{ type: "text", text: JSON.stringify(todo) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // update_todo
  server.registerTool(
    "update_todo",
    {
      description: "Update a todo item. Can update content, done status, and custom chore fields.",
      inputSchema: {
        id: z.number().describe("Todo ID to update"),
        content: z.string().optional().describe("New content/name"),
        done: z.string().nullable().optional().describe("ISO timestamp when done, or null to mark as pending"),
        isCustomChore: z.boolean().optional().describe("Toggle custom chore flag"),
        choreRank: z.number().int().nullable().optional().describe("New chore rank"),
        chorePrompt: z.string().nullable().optional().describe("New chore prompt"),
      },
    },
    async ({ id, ...data }) => {
      try {
        const todo = await patch<Todo>(`/api/v1/todos/${id}`, data);
        return { content: [{ type: "text", text: JSON.stringify(todo) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // delete_todo
  server.registerTool(
    "delete_todo",
    {
      description: "Delete a todo item permanently",
      inputSchema: {
        id: z.number().describe("Todo ID to delete"),
      },
    },
    async ({ id }) => {
      try {
        await del<void>(`/api/v1/todos/${id}`);
        return { content: [{ type: "text", text: `Todo ${id} deleted` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // toggle_todo
  server.registerTool(
    "toggle_todo",
    {
      description: "Toggle a todo's completion status. For custom chores, this marks them as done/undone in the chore queue.",
      inputSchema: {
        id: z.number().describe("Todo ID to toggle"),
      },
    },
    async ({ id }) => {
      try {
        const todo = await post<Todo>(`/api/v1/todos/${id}/toggle`);
        return { content: [{ type: "text", text: JSON.stringify(todo) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
