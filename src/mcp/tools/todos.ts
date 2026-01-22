import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, post, type Todo, type ListResponse } from "../client.js";

export function registerTodoTools(server: McpServer) {
  // list_todos
  server.registerTool(
    "list_todos",
    {
      description: "List todos with optional filters",
      inputSchema: {
        taskId: z.number().optional().describe("Filter by parent task ID"),
        done: z.boolean().optional().describe("Filter by completion status"),
      },
    },
    async ({ taskId, done }) => {
      const params = new URLSearchParams();
      if (taskId !== undefined) params.set("taskId", String(taskId));
      if (done !== undefined) params.set("done", String(done));

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
      description: "Create a new todo item",
      inputSchema: {
        content: z.string().describe("Todo content/text"),
        taskId: z.number().optional().describe("Parent task ID"),
        placement: z.enum(["top", "bottom"]).optional().describe("Where to insert the todo (default: bottom)"),
      },
    },
    async ({ content, taskId, placement }) => {
      try {
        const todo = await post<Todo>("/api/v1/todos", {
          content,
          taskId: taskId || null,
          placement: placement || undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(todo) }] };
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
      description: "Toggle a todo's completion status",
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
