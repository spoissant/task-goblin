import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, post, patch, del, type Todo, type ListResponse } from "../client.js";

export function registerTodoTools(server: McpServer) {
  // list_todos
  server.registerTool(
    "list_todos",
    {
      description: "List todos with optional filters. Pending todos are unresolved feedback on their task, addressed via chore 4 (/chore-address-pr-comments).",
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
      description: "Create a new todo item — a note of work still owed on the task, treated like a PR review comment. A task with any pending todo surfaces chore 4 (/chore-address-pr-comments).",
      inputSchema: {
        content: z.string().describe("Todo content — the work to perform"),
        taskId: z.number().optional().describe("Parent task ID"),
        placement: z.enum(["top", "bottom"]).optional().describe("Where to insert the todo (default: bottom)"),
      },
    },
    async ({ content, taskId, placement }) => {
      try {
        const placementMapped = placement === "top" ? "start" : placement === "bottom" ? "end" : undefined;
        const todo = await post<Todo>("/api/v1/todos", {
          content,
          taskId: taskId || null,
          placement: placementMapped,
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
      description: "Update a todo item — content and/or done status.",
      inputSchema: {
        id: z.number().describe("Todo ID to update"),
        content: z.string().optional().describe("New content/name"),
        done: z.string().nullable().optional().describe("ISO timestamp when done, or null to mark as pending"),
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
      description: "Toggle a todo's completion status. Marking the last pending todo done clears chore 4 for its task.",
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
