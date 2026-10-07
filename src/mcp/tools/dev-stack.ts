import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DevStack, DevStackLoginLink, DevStackRefresh, DevStackStatus } from "@/shared/types";
import { get, post, del } from "../client.js";

const POLL_MS = 5_000;
const MAX_WAIT_SECONDS = 300;

const taskIdSchema = z.number().int().describe("Task ID whose branch the stack runs");

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** Poll until the stack leaves starting/stopping, or the wait runs out. */
async function waitForSettled(taskId: number, waitSeconds: number): Promise<DevStackStatus> {
  const deadline = Date.now() + Math.min(waitSeconds, MAX_WAIT_SECONDS) * 1000;
  let status = await get<DevStackStatus>(`/api/v1/tasks/${taskId}/dev-stack`);
  while (Date.now() < deadline && (status.stack?.state === "starting" || status.stack?.state === "stopping")) {
    await Bun.sleep(POLL_MS);
    status = await get<DevStackStatus>(`/api/v1/tasks/${taskId}/dev-stack`);
  }
  return status;
}

export function registerDevStackTools(server: McpServer) {
  // dev_stack_status
  server.registerTool(
    "dev_stack_status",
    {
      description:
        "Get the local dev stack for a task's repository (alumni_connect runs the full app, front-monorepo runs Storybook). " +
        "Returns { supported, stack }. stack is null when nothing runs; otherwise { taskId, prUrl, branch, state " +
        "(starting | up | stopping | failed), detail, error, url, logTail, ... }. The stack is per repository, so it may " +
        "belong to another task or PR: compare stack.taskId with yours. Pass waitSeconds to block until the stack " +
        `leaves starting/stopping (max ${MAX_WAIT_SECONDS}s per call; booting can take several minutes, so call again if still starting).`,
      inputSchema: {
        taskId: taskIdSchema,
        waitSeconds: z.number().int().min(0).optional().describe("Wait up to N seconds for starting/stopping to settle"),
      },
    },
    async ({ taskId, waitSeconds }) => {
      try {
        return result(await waitForSettled(taskId, waitSeconds ?? 0));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // start_dev_stack
  server.registerTool(
    "start_dev_stack",
    {
      description:
        "Boot the task's branch in the repository's main checkout and start the dev stack in the background. " +
        "Returns the stack in state starting (or the existing stack if this task already owns one). Fails if another " +
        "task or PR owns the stack, or the main checkout has uncommitted changes. Follow with dev_stack_status(waitSeconds) until up or failed.",
      inputSchema: { taskId: taskIdSchema },
    },
    async ({ taskId }) => {
      try {
        return result(await post<DevStack>(`/api/v1/tasks/${taskId}/dev-stack`));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // refresh_dev_stack
  server.registerTool(
    "refresh_dev_stack",
    {
      description:
        "Move the running stack's checkout to the latest commit of the task branch without restarting it (the bundler reloads). " +
        "Only works when this task owns a stack that is up. New migrations and packages are not installed. Returns { from, to } short shas.",
      inputSchema: { taskId: taskIdSchema },
    },
    async ({ taskId }) => {
      try {
        return result(await post<DevStackRefresh>(`/api/v1/tasks/${taskId}/dev-stack/refresh`));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // dev_stack_login_link
  server.registerTool(
    "dev_stack_login_link",
    {
      description:
        "Mint a one-time sign-in link into the running alumni_connect stack (single use, valid 10 minutes, no password needed). " +
        "Open the returned url in the browser to be signed in. as: member (front office, lands on the member's profile), " +
        "admin (a network admin, lands on the network back office) or super_admin (the network back office as super admin). " +
        "id picks a specific user (member) or admin (admin); default is the first confirmed one of network 1 (pandora). " +
        "Member and admin sessions are impersonations: a red bar shows, and its link returns to the back office. " +
        "Only works when this task owns a stack that is up. Returns { url, subjectId, name, networkId }; takes ~20s.",
      inputSchema: {
        taskId: taskIdSchema,
        as: z.enum(["member", "admin", "super_admin"]).describe("Who to sign in as"),
        id: z.number().int().optional().describe("User id (member) or admin id (admin); ignored for super_admin"),
      },
    },
    async ({ taskId, as, id }) => {
      try {
        return result(await post<DevStackLoginLink>(`/api/v1/tasks/${taskId}/dev-stack/login-link`, { as, id }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // stop_dev_stack
  server.registerTool(
    "stop_dev_stack",
    {
      description:
        "Stop the dev stack this task owns and switch the main checkout back to its base branch (discarding local changes there), " +
        "in the background. Fails if another task or PR owns the stack. Follow with dev_stack_status(waitSeconds): stack is null once stopped.",
      inputSchema: { taskId: taskIdSchema },
    },
    async ({ taskId }) => {
      try {
        return result(await del<DevStack>(`/api/v1/tasks/${taskId}/dev-stack`));
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
