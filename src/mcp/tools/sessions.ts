import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SESSION_EFFORTS, SESSION_MODELS, type ClaudeSession, type ListResponse } from "@/shared/types";
import { get, post } from "../client.js";

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function registerSessionTools(server: McpServer) {
  // start_session
  server.registerTool(
    "start_session",
    {
      description:
        "Start a background Claude Code session (claude --bg --rc) in the task's worktree, tracked in Task Goblin's AI column. " +
        "Pass choreKey to run a chore (any key from chore_definitions), optionally with " +
        "prompt replacing the chore's command; or pass prompt alone for a custom session. model and effort default to the " +
        "chore's settings. Returns the session row (state starts as spawning).",
      inputSchema: {
        taskId: z.number().int().describe("Task ID"),
        choreKey: z.string().optional().describe("Chore key, e.g. ai-qa, fix-merge-conflicts, deploy-test-env"),
        prompt: z.string().optional().describe("Custom prompt (required when choreKey is omitted)"),
        model: z.enum(SESSION_MODELS).optional(),
        effort: z.enum(SESSION_EFFORTS).optional(),
      },
    },
    async ({ taskId, ...body }) => {
      try {
        return result(await post<ClaudeSession>(`/api/v1/tasks/${taskId}/sessions`, body));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // list_task_sessions
  server.registerTool(
    "list_task_sessions",
    {
      description: "List a task's Claude Code sessions, newest first, with state and Remote Control link.",
      inputSchema: { taskId: z.number().int().describe("Task ID") },
    },
    async ({ taskId }) => {
      try {
        return result(await get<ListResponse<ClaudeSession>>(`/api/v1/tasks/${taskId}/sessions`));
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
