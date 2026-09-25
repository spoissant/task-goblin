import { z } from "zod";
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

  // get_pr_changes_by_category
  server.registerTool(
    "get_pr_changes_by_category",
    {
      description:
        "Get a GitHub PR's size and frontend/backend split, fetched live from GitHub. Returns totalFiles, totalAdditions, totalDeletions, size (small | medium | large), and frontend / backend / other buckets, each with files, additions, deletions, and percent of files. Only the first 300 changed files are counted. Errors if GitHub is not configured or the PR does not exist.",
      inputSchema: {
        owner: z.string().describe("Repository owner (e.g. 'acme')"),
        repo: z.string().describe("Repository name (e.g. 'frontend')"),
        prNumber: z.number().int().describe("Pull request number"),
      },
    },
    async ({ owner, repo, prNumber }) => {
      try {
        const data = await get<unknown>(
          `/api/v1/github/pull-requests/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${prNumber}/changes-by-category`
        );
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
