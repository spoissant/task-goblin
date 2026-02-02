import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  get,
  post,
  patch,
  put,
  type Note,
  type NoteWithTasks,
  type ListResponse,
} from "../client.js";

interface PaginatedResponse<T> extends ListResponse<T> {
  limit: number;
  offset: number;
}

export function registerNoteTools(server: McpServer) {
  // list_notes
  server.registerTool(
    "list_notes",
    {
      description: "List notes with optional search and pagination",
      inputSchema: {
        q: z.string().optional().describe("Search query (searches title and content)"),
        limit: z.number().optional().describe("Max results (default: 50)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async ({ q, limit, offset }) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (limit !== undefined) params.set("limit", String(limit));
      if (offset !== undefined) params.set("offset", String(offset));

      const queryString = params.toString();
      const path = `/api/v1/notes${queryString ? `?${queryString}` : ""}`;

      const result = await get<PaginatedResponse<Note>>(path);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // get_note
  server.registerTool(
    "get_note",
    {
      description: "Get a note by ID with its linked tasks",
      inputSchema: {
        id: z.number().describe("Note ID"),
      },
    },
    async ({ id }) => {
      try {
        const note = await get<NoteWithTasks>(`/api/v1/notes/${id}`);
        return { content: [{ type: "text", text: JSON.stringify(note) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // create_note
  server.registerTool(
    "create_note",
    {
      description: "Create a new note",
      inputSchema: {
        title: z.string().describe("Note title"),
        content: z.string().optional().describe("Note content (markdown)"),
        taskIds: z.array(z.number()).optional().describe("Task IDs to link"),
      },
    },
    async ({ title, content, taskIds }) => {
      try {
        const note = await post<Note>("/api/v1/notes", {
          title,
          content: content || null,
          taskIds: taskIds || [],
        });
        return { content: [{ type: "text", text: JSON.stringify(note) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // update_note
  server.registerTool(
    "update_note",
    {
      description: "Update an existing note",
      inputSchema: {
        id: z.number().describe("Note ID"),
        title: z.string().optional().describe("New title"),
        content: z.string().optional().describe("New content (markdown)"),
      },
    },
    async ({ id, title, content }) => {
      try {
        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (content !== undefined) updates.content = content;

        const note = await patch<Note>(`/api/v1/notes/${id}`, updates);
        return { content: [{ type: "text", text: JSON.stringify(note) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // link_note_tasks
  server.registerTool(
    "link_note_tasks",
    {
      description: "Set the tasks linked to a note (replaces existing links)",
      inputSchema: {
        noteId: z.number().describe("Note ID"),
        taskIds: z.array(z.number()).describe("Task IDs to link"),
      },
    },
    async ({ noteId, taskIds }) => {
      try {
        const note = await put<NoteWithTasks>(`/api/v1/notes/${noteId}/tasks`, {
          taskIds,
        });
        return { content: [{ type: "text", text: JSON.stringify(note) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
