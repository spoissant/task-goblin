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
        withTaskIds: z
          .array(z.number().int())
          .optional()
          .describe("Other tasks of a bulk chore run (chores with supportsBulk); linked to the session so they count as busy"),
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

  // list_sessions
  server.registerTool(
    "list_sessions",
    {
      description:
        "List Claude Code sessions across all tasks (task-less PR reviews included), newest first, paginated. " +
        "since keeps sessions Claude was active in from that time on. Each item carries taskId, taskTitle, name " +
        "(\"<JIRA-KEY> · <chore>\"), state and the session's own result/detail/needs summary; the prompt is left out.",
      inputSchema: {
        since: z.string().optional().describe("ISO 8601 timestamp, e.g. 2026-10-12T14:00:00Z"),
        limit: z.number().int().optional().default(100).describe("Page size (max 100)"),
        offset: z.number().int().optional().default(0).describe("Offset for pagination"),
      },
    },
    async ({ since, limit, offset }) => {
      try {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (since) params.set("since", since);
        const data = await get<ListResponse<ClaudeSession & { taskTitle: string | null }>>(`/api/v1/sessions/recent?${params}`);
        return result({ ...data, items: data.items.map(({ prompt: _prompt, ...rest }) => rest) });
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
