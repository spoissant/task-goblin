import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ListResponse, TeamChannel } from "@/shared/types";
import { get, toolResult } from "../client.js";

export function registerReviewTools(server: McpServer) {
  // list_team_channels
  server.registerTool(
    "list_team_channels",
    {
      description:
        "List the GitHub team → Slack channel mappings used to route review requests. Returns { items: [{ id, githubTeamSlug, slackChannel }], total }, sorted by team slug. Match a PR's requested reviewer team slugs against githubTeamSlug to find which Slack channels to notify. Teams with no mapping are simply absent. Read-only.",
      inputSchema: {},
    },
    () => toolResult(() => get<ListResponse<TeamChannel>>("/api/v1/team-channels"))
  );
}
