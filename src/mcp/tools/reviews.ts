import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";

export function registerReviewTools(server: McpServer) {
  // list_team_channels
  server.registerTool(
    "list_team_channels",
    {
      description:
        "List the GitHub team → Slack channel mappings used to route review requests. Returns { items: [{ id, githubTeamSlug, slackChannel }], total }, sorted by team slug. Match a PR's requested reviewer team slugs against githubTeamSlug to find which Slack channels to notify. Teams with no mapping are simply absent. Read-only.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await get<{ items: unknown[] }>("/api/v1/team-channels");
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
