import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get, post, patch, del, resolveTaskId, resolveRepositoryId, taskLookup, toolResult } from "../client.js";
import type { ListResponse, SyncRunResult, Task, TaskDetail, TaskSyncResult, TaskWorktreeStatus } from "@/shared/types";

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
      inputSchema: taskLookup,
    },
    (lookup) => toolResult(async () => get<TaskDetail>(`/api/v1/tasks/${await resolveTaskId(lookup)}`))
  );

  // create_task
  server.registerTool(
    "create_task",
    {
      description:
        "Create a task from a GitHub PR, e.g. a colleague's PR the sync doesn't pull (it only pulls the configured user's PRs). " +
        "Links it like the sync does (to the Jira task its title names, if any) and returns the task with its repository.",
      inputSchema: {
        owner: z.string().describe("GitHub repo owner (user or org)"),
        repo: z.string().describe("GitHub repo name"),
        prNumber: z.number().int().describe("GitHub PR number"),
      },
    },
    ({ owner, repo, prNumber }) =>
      toolResult(() => post<TaskDetail>("/api/v1/tasks/from-pr", { owner, repo, prNumber }))
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
    ({ status, statuses, title, completed, checks, hasComments, limit, offset }) =>
      toolResult(async () => {
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
        return get<ListResponse<Task>>(qs ? `${base}?${qs}` : base);
      })
  );

  // sync
  server.registerTool(
    "sync",
    {
      description:
        "Run one full sync pass, the one the 5-minute timer runs: pulls Jira issues and GitHub PRs (linking each PR to its " +
        "task), recounts worktree git statuses, then runs the merge watch, moves merged tickets to Ready to Prod, runs the " +
        "merge gate and the chore scheduler, which may start AI sessions on other tasks. If a pass is already running, " +
        "waits for it and returns its result. Returns { jira, github, errors }: jira and github are " +
        "{ synced, new, updated, unchanged }, or null when that step failed; errors lists { step, message }.",
      inputSchema: {},
    },
    () => toolResult(() => post<SyncRunResult>("/api/v1/sync"))
  );

  // sync_task
  server.registerTool(
    "sync_task",
    {
      description:
        "Sync a single task from its sources: re-pulls its Jira issue and GitHub PR (whichever it has), and recounts its worktree's uncommitted files and unpushed commits. " +
        "A task without a PR gets the PR opened from its branch (headBranch or worktree branch) linked. " +
        "Located by ID, Jira key, PR number, or branch name. Returns { task, errors }: the refreshed task with its " +
        "repository, and one message per source that failed (\"Jira: …\", \"GitHub: …\", \"Git status: …\").",
      inputSchema: taskLookup,
    },
    (lookup) =>
      toolResult(async () => post<TaskSyncResult>(`/api/v1/tasks/${await resolveTaskId(lookup)}/sync`))
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
    ({ taskId, waitSeconds }) =>
      toolResult(async () => {
        await post(`/api/v1/tasks/${taskId}/worktree`);
        return waitForWorktree(taskId, waitSeconds ?? 120);
      })
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
        ...taskLookup,
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
    ({ title, description, status, repository, choreSkips, ...lookup }) =>
      toolResult(async () => {
        const taskId = await resolveTaskId(lookup);

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

        return get<TaskDetail>(`/api/v1/tasks/${taskId}`);
      })
  );

  // delete_task
  server.registerTool(
    "delete_task",
    {
      description:
        "Permanently delete a task, located by ID, Jira key, PR number, or branch name. Also tears down the task's " +
        "worktree. A later sync re-creates it if its Jira issue or PR is still picked up by the sync.",
      inputSchema: taskLookup,
    },
    (lookup) =>
      toolResult(async () => {
        const taskId = await resolveTaskId(lookup);
        await del(`/api/v1/tasks/${taskId}`);
        return { deleted: taskId };
      })
  );
}
