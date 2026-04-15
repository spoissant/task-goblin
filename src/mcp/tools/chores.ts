import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";

export function registerChoreTools(server: McpServer) {
  // chore_definitions
  server.registerTool(
    "chore_definitions",
    {
      description:
        "List all chore definitions — number, name, condition, and prompt template. Use this to understand the full chore workflow at a glance without querying live task data.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await get<{ items: unknown[] }>("/api/v1/chores/definitions");
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // list_chores
  server.registerTool(
    "list_chores",
    {
      description:
        "List all actionable chores across tasks — one entry per chore+task pair, ordered by chore number (priority) then task priority. Chores 1-8 are post-implementation housekeeping (assign Jira ticket, fix PR checks, address PR comments, code review, request reviews, fix merge conflicts, deploy to test env, dev QA video). Chore 9 is in-progress work. Chore 10 is tasks not yet started.",
      inputSchema: {
        repository: z
          .string()
          .optional()
          .describe("Filter by repo in owner/repo format (e.g. 'acme/frontend')"),
        minChore: z.number().int().optional().describe("Only return chores with number >= this"),
        maxChore: z.number().int().optional().describe("Only return chores with number <= this"),
      },
    },
    async ({ repository, minChore, maxChore }) => {
      try {
        const params = new URLSearchParams();
        if (repository) params.set("repository", repository);
        if (minChore !== undefined) params.set("minChore", String(minChore));
        if (maxChore !== undefined) params.set("maxChore", String(maxChore));
        const query = params.toString();
        const data = await get<{ items: unknown[] }>(`/api/v1/chores${query ? `?${query}` : ""}`);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // next_chore
  server.registerTool(
    "next_chore",
    {
      description:
        "Return the single highest-priority actionable chore+task. Same ordering as list_chores but returns only the first match. Returns null if nothing is actionable.",
      inputSchema: {
        repository: z
          .string()
          .optional()
          .describe("Filter by repo in owner/repo format (e.g. 'acme/frontend')"),
        minChore: z.number().int().optional().describe("Only consider chores with number >= this"),
        maxChore: z.number().int().optional().describe("Only consider chores with number <= this"),
      },
    },
    async ({ repository, minChore, maxChore }) => {
      try {
        const params = new URLSearchParams();
        if (repository) params.set("repository", repository);
        if (minChore !== undefined) params.set("minChore", String(minChore));
        if (maxChore !== undefined) params.set("maxChore", String(maxChore));
        const query = params.toString();
        const data = await get<unknown>(`/api/v1/chores/next${query ? `?${query}` : ""}`);
        if (data === null) {
          return { content: [{ type: "text", text: "No actionable chores found." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
