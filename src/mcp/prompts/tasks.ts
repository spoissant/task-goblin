import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerTaskPrompts(server: McpServer) {
  server.registerPrompt("tasks-by-status", {
    description: "List and summarize tasks in a given status",
    argsSchema: {
      status: z.string().describe("Status name to filter by (e.g. 'In Progress', 'To Do')"),
    },
  }, ({ status }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Use the list_tasks tool with status="${status}" to retrieve all tasks in that status. Then summarize each task briefly (title, PR info if any, key details).`,
        },
      },
    ],
  }));

  server.registerPrompt("task-overview", {
    description: "Dashboard overview of all active tasks grouped by status",
  }, () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Use the list_tasks tool to fetch all active tasks. Group them by status and provide a concise summary of each group, including task count and notable items.",
        },
      },
    ],
  }));

  server.registerPrompt("find-task", {
    description: "Search tasks by title keyword",
    argsSchema: {
      query: z.string().describe("Keyword to search in task titles"),
    },
  }, ({ query }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Use the list_tasks tool with title="${query}" to search for matching tasks. List each result with its ID, title, status, and any PR/Jira info.`,
        },
      },
    ],
  }));
}
