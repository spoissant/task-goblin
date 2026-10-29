import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChoreDefinition } from "@/shared/chores";
import { get, toolResult } from "../client.js";

export function registerChoreTools(server: McpServer) {
  // chore_definitions
  server.registerTool(
    "chore_definitions",
    {
      description:
        "List every chore: key (start_session's choreKey), number, name, the condition a task must meet, the prompt " +
        "template, and the flags supportsBulk (runs on several tasks in one session), requiresSameRepo, repoPairs " +
        "(multi-repo chores) and auto (the chore scheduler starts it on its own).",
      inputSchema: {},
    },
    () => toolResult(() => get<{ items: ChoreDefinition[] }>("/api/v1/chores/definitions"))
  );
}
