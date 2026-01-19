import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { post } from "../client.js";

interface SyncResult {
  synced?: number;
  [key: string]: unknown;
}

export function registerRefreshTools(server: McpServer) {
  server.registerTool(
    "refresh",
    {
      description: "Trigger a sync of tasks from external sources (Jira and/or GitHub)",
      inputSchema: {
        source: z.enum(["jira", "github", "all"]).describe("Data source to refresh"),
      },
    },
    async ({ source }) => {
      try {
        const results: Record<string, SyncResult> = {};

        if (source === "jira" || source === "all") {
          results.jira = await post<SyncResult>("/api/v1/refresh/jira");
        }

        if (source === "github" || source === "all") {
          results.github = await post<SyncResult>("/api/v1/refresh/github");
        }

        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
