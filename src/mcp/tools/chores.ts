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
}
