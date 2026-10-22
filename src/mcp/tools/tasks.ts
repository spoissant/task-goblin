import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, post, patch, del, resolveTaskId, resolveRepositoryId } from "../client.js";
import type { ListResponse, SyncResult, Task, TaskDetail, TaskWorktreeStatus } from "@/shared/types";

const WORKTREE_POLL_MS = 3_000;
const WORKTREE_MAX_WAIT_SECONDS = 300;

/** Poll until the task's worktree leaves preparing, or the wait runs out. */
async function waitForWorktree(taskId: number, waitSeconds: number): Promise<TaskWorktreeStatus | null> {
  const deadline = Date.now() + Math.min(waitSeconds, WORKTREE_MAX_WAIT_SECONDS) * 1000;
  let status = await get<TaskWorktreeStatus | null>(`/api/v1/tasks/${taskId}/worktree`);
  while (Date.now() < deadline && status?.state === "preparing") {
    await Bun.sleep(WORKTREE_POLL_MS);
    status = await get<TaskWorktreeStatus | null>(`/api/v1/tasks/${taskId}/worktree`);
  }
  return status;
}

export function registerTaskTools(server: McpServer) {
  // get_task
  server.registerTool(
    "get_task",
    {
      description:
        "Get a single task by ID, Jira key, PR number, or branch name. Returns task with its repository.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("GitHub PR number"),
        repo: z
          .string()
          .optional()
          .describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
        branch: z.string().optional().describe("Git branch name (headBranch)"),
      },
    },
    async ({ id, jiraKey, prNumber, repo, branch }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });
        const task = await get<TaskDetail>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // list_tasks
  server.registerTool(
    "list_tasks",
    {
      description:
        "List tasks, paginated. Returns { items, total }; page with offset until you have total. " +
        "Completed tasks are excluded unless completed=true. status and statuses match the raw task status name " +
        "(case-insensitive), not a status category. With completed=true only title, limit and offset apply; " +
        "the other filters are ignored.",
      inputSchema: {
        status: z.string().optional().describe("Filter by status name"),
        statuses: z.string().optional().describe("Comma-separated list of status names to filter by (e.g. 'Code Review,Ready to Merge')"),
        title: z.string().optional().describe("Substring search on title, Jira key, or branch name. Combine terms with | (OR) and & (AND, binds tighter); prefix a term with ~ to negate (e.g. 'tiptap | editor & ~bug')"),
        completed: z.boolean().optional().describe("When true, fetch completed tasks instead"),
        checks: z.enum(["passing", "failing"]).optional().describe("Filter by CI checks status"),
        hasComments: z.boolean().optional().describe("Filter by unresolved comments presence"),
        limit: z.number().int().optional().default(25).describe("Page size (default 25)"),
        offset: z.number().int().optional().default(0).describe("Offset for pagination"),
      },
    },
    async ({ status, statuses, title, completed, checks, hasComments, limit, offset }) => {
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (statuses) params.set("statuses", statuses);
        if (title) params.set("title", title);
        if (checks) params.set("checks", checks);
        if (hasComments !== undefined) params.set("hasComments", String(hasComments));
        if (limit !== undefined) params.set("limit", String(limit));
        if (offset !== undefined) params.set("offset", String(offset));
        // The completed endpoint hides done-status tasks unless asked (a UI toggle); agents want them all.
        if (completed) params.set("showDone", "true");

        const base = completed ? "/api/v1/tasks/completed" : "/api/v1/tasks";
        const qs = params.toString();
        const path = qs ? `${base}?${qs}` : base;

        const data = await get<ListResponse<Task>>(path);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // create_task
  server.registerTool(
    "create_task",
    {
      description: "Create a task from a GitHub PR. Syncs the PR from GitHub and returns the created or updated task.",
      inputSchema: {
        owner: z.string().describe("GitHub repo owner (user or org)"),
        repo: z.string().describe("GitHub repo name"),
        prNumber: z.number().int().describe("GitHub PR number"),
      },
    },
    async ({ owner, repo, prNumber }) => {
      try {
        await post(`/api/v1/sync/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${prNumber}`);
        const task = await get<Task>(
          `/api/v1/tasks/by-pr/${prNumber}?repo=${encodeURIComponent(`${owner}/${repo}`)}`
        );
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // sync
  server.registerTool(
    "sync",
    {
      description:
        "Trigger a full sync: pulls latest Jira issues and GitHub PRs, then auto-matches orphaned tasks.",
      inputSchema: {},
    },
    async () => {
      const result: { jira?: SyncResult; github?: SyncResult; matched?: number; errors: string[] } = {
        errors: [],
      };

      try {
        result.jira = await post<SyncResult>("/api/v1/sync/jira");
      } catch (err) {
        result.errors.push(`Jira: ${err instanceof Error ? err.message : String(err)}`);
      }

      try {
        result.github = await post<SyncResult>("/api/v1/sync/github");
      } catch (err) {
        result.errors.push(`GitHub: ${err instanceof Error ? err.message : String(err)}`);
      }

      try {
        const match = await post<{ merged: number }>("/api/v1/sync/match");
        result.matched = match.merged;
      } catch (err) {
        result.errors.push(`Match: ${err instanceof Error ? err.message : String(err)}`);
      }

      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // sync_task
  server.registerTool(
    "sync_task",
    {
      description:
        "Sync a single task from its sources: re-pulls its Jira issue and GitHub PR (whichever it has), and recounts its worktree's uncommitted files and unpushed commits. " +
        "A task without a PR gets the PR opened from its branch (headBranch or worktree branch) linked. " +
        "Located by ID, Jira key, PR number, or branch name. Returns the refreshed task.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("GitHub PR number"),
        repo: z
          .string()
          .optional()
          .describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
        branch: z.string().optional().describe("Git branch name (headBranch)"),
      },
    },
    async ({ id, jiraKey, prNumber, repo, branch }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });
        const task = await get<TaskDetail>(`/api/v1/tasks/${taskId}`);
        const errors: string[] = [];

        if (task.jiraKey) {
          try {
            await post(`/api/v1/sync/jira/${encodeURIComponent(task.jiraKey)}`);
          } catch (err) {
            errors.push(`Jira: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // A PR just opened from the task's branch isn't linked yet: look it up by branch.
        // Linking fetches the PR, so the sync below only runs for an already-linked PR.
        if (!task.prNumber) {
          try {
            await post(`/api/v1/tasks/${taskId}/link-pr-by-branch`);
          } catch (err) {
            errors.push(`GitHub: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (task.repository) {
          const { owner, repo: repoName } = task.repository;
          try {
            await post(`/api/v1/sync/github/${owner}/${repoName}/${task.prNumber}`);
          } catch (err) {
            errors.push(`GitHub: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        try {
          await post(`/api/v1/tasks/${taskId}/worktree/git-status`);
        } catch (err) {
          errors.push(`Git status: ${err instanceof Error ? err.message : String(err)}`);
        }

        const refreshed = await get<TaskDetail>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify({ task: refreshed, errors }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // prepare_task_worktree
  server.registerTool(
    "prepare_task_worktree",
    {
      description:
        "Prepare a task's git worktree (its branch checked out next to the repository's main checkout, then the repository's " +
        "setup command run, e.g. pnpm install) and return it: { path, branch, state (preparing | ready | failed | dirty | removing), " +
        "error, setupLog, changedFiles }. A ready worktree is returned as is. Lets a session work in another task's checkout. " +
        `Waits up to waitSeconds (default 120, max ${WORKTREE_MAX_WAIT_SECONDS}) for preparing to settle; call again if still preparing.`,
      inputSchema: {
        taskId: z.number().int().describe("Task ID"),
        waitSeconds: z.number().int().min(0).optional().describe("Wait up to N seconds for preparing to settle"),
      },
    },
    async ({ taskId, waitSeconds }) => {
      try {
        await post(`/api/v1/tasks/${taskId}/worktree`);
        const status = await waitForWorktree(taskId, waitSeconds ?? 120);
        return { content: [{ type: "text", text: JSON.stringify(status) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // update_task
  server.registerTool(
    "update_task",
    {
      description:
        "Update an existing task, located by ID, Jira key, PR number, or branch name. Only the fields you pass change; " +
        "returns the full task. status is rejected for Jira-linked tasks (Jira owns it) and must be one of the configured " +
        "statuses. choreSkips replaces the whole skip map, so include existing skips you want to keep.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("GitHub PR number"),
        repo: z
          .string()
          .optional()
          .describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
        branch: z.string().optional().describe("Git branch name (headBranch)"),
        title: z.string().optional().describe("New task title"),
        description: z.string().optional().describe("New task description"),
        status: z.string().optional().describe("New task status"),
        repository: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Move the task to this repository: 'owner/repo', bare repo name, or alias. null clears it. Only works while the task has no PR - once a PR exists its repository wins."
          ),
        choreSkips: z.string().optional().describe("JSON chore skip flags, e.g. '{\"fix-pr-checks\": true}'"),
      },
    },
    async ({ id, jiraKey, prNumber, repo, branch, title, description, status, repository, choreSkips }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });

        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;
        if (repository !== undefined) {
          updates.repositoryId = repository === null ? null : await resolveRepositoryId(repository);
        }
        if (choreSkips !== undefined) updates.choreSkips = choreSkips;

        if (Object.keys(updates).length > 0) {
          await patch(`/api/v1/tasks/${taskId}`, updates);
        }

        const fullTask = await get<TaskDetail>(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(fullTask) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  // delete_task
  server.registerTool(
    "delete_task",
    {
      description:
        "Permanently delete a task, located by ID, Jira key, PR number, or branch name. Also tears down the task's " +
        "worktree. A later sync re-creates it if its Jira issue or PR is still picked up by the sync.",
      inputSchema: {
        id: z.number().optional().describe("Task ID"),
        jiraKey: z.string().optional().describe("Jira key to look up task"),
        prNumber: z.number().optional().describe("GitHub PR number"),
        repo: z
          .string()
          .optional()
          .describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
        branch: z.string().optional().describe("Git branch name (headBranch)"),
      },
    },
    async ({ id, jiraKey, prNumber, repo, branch }) => {
      try {
        const taskId = await resolveTaskId({ id, jiraKey, prNumber, repo, branch });
        await del(`/api/v1/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: taskId }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
