import { eq, and, asc } from "drizzle-orm";
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { db } from "../../db";
import { agents, prompts, tasks } from "../../db/schema";
import { broadcast } from "../lib/sse";
import { spawn } from "child_process";
import { runGit } from "../lib/git";
import { expandPath } from "../lib/path";

type SSEClient = {
  controller: ReadableStreamDefaultController;
  closed: boolean;
};

const POLL_INTERVAL_MS = 5_000;
const PROMPT_TIMEOUT_MS = 20 * 60 * 1_000; // 20 min

// Active runners keyed by agentId
const runners = new Map<number, AgentRunner>();

// Per-prompt output SSE clients
const outputClients = new Map<number, Set<SSEClient>>();

// Per-prompt output buffer for replaying to late-connecting clients
const outputBuffers = new Map<number, any[]>();

class AgentRunner {
  private polling = false;
  private currentPromptId: number | null = null;
  private abortController: AbortController | null = null;
  private pendingResolve:
    | ((response: { approved: boolean; message?: string }) => void)
    | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeResolve: (() => void) | null = null;

  constructor(private agentId: number) {}

  async start() {
    this.polling = true;

    // Resolve agent's repositoryId via worktree
    const agentRow = await db.query.agents.findFirst({
      where: eq(agents.id, this.agentId),
      with: { worktree: true },
    });

    if (!agentRow?.worktree) {
      this.polling = false;
      return;
    }

    const repositoryId = agentRow.worktree.repositoryId;

    while (this.polling) {
      // Check agent status in DB (may have been stopped externally)
      const agentStatus = await db
        .select({ status: agents.status })
        .from(agents)
        .where(eq(agents.id, this.agentId));

      if (agentStatus.length === 0 || agentStatus[0].status !== "running") {
        this.polling = false;
        break;
      }

      // Atomically claim the oldest pending prompt for this repository
      const claimed = await db
        .update(prompts)
        .set({
          agentId: this.agentId,
          status: "running",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(prompts.repositoryId, repositoryId),
            eq(prompts.status, "pending"),
            // Pick the one with lowest position/id
            eq(
              prompts.id,
              db
                .select({ id: prompts.id })
                .from(prompts)
                .where(
                  and(
                    eq(prompts.repositoryId, repositoryId),
                    eq(prompts.status, "pending"),
                  ),
                )
                .orderBy(asc(prompts.position), asc(prompts.id))
                .limit(1),
            ),
          ),
        )
        .returning();

      if (claimed.length === 0) {
        // No pending prompts — broadcast poll timing then interruptible sleep
        broadcast("agent_poll", {
          agentId: this.agentId,
          nextPollAt: Date.now() + POLL_INTERVAL_MS,
        });
        await new Promise<void>((resolve) => {
          this.wakeResolve = resolve;
          setTimeout(() => {
            this.wakeResolve = null;
            resolve();
          }, POLL_INTERVAL_MS);
        });
        continue;
      }

      const prompt = claimed[0];
      this.currentPromptId = prompt.id;
      broadcast("prompt");

      try {
        await this.executePrompt(prompt);
      } catch (err) {
        // If prompt wasn't already marked terminal, mark as failed
        const current = await db
          .select({ status: prompts.status })
          .from(prompts)
          .where(eq(prompts.id, prompt.id));

        if (current.length > 0 && current[0].status === "running") {
          await db
            .update(prompts)
            .set({
              status: "failed",
              errorMessage: err instanceof Error ? err.message : String(err),
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            })
            .where(eq(prompts.id, prompt.id));
        }
        broadcast("prompt");
      } finally {
        // Persist output buffer to DB before clearing
        const buffer = outputBuffers.get(prompt.id);
        if (buffer?.length) {
          await db
            .update(prompts)
            .set({ messages: JSON.stringify(buffer) })
            .where(eq(prompts.id, prompt.id));
        }
        clearOutputBuffer(prompt.id);
        this.currentPromptId = null;
        this.abortController = null;
        this.pendingResolve = null;
        if (this.timeoutTimer) {
          clearTimeout(this.timeoutTimer);
          this.timeoutTimer = null;
        }
      }
    }
  }

  private async executePrompt(prompt: typeof prompts.$inferSelect) {
    // Load agent config + worktree
    const agentRow = await db.query.agents.findFirst({
      where: eq(agents.id, this.agentId),
      with: { worktree: true },
    });

    if (!agentRow?.worktree) return;

    const { worktree, ...agent } = agentRow;
    const resolvedPath = expandPath(worktree.path);

    // Load task context if taskId set
    let task: typeof tasks.$inferSelect | null = null;
    if (prompt.taskId) {
      const taskRows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, prompt.taskId));
      if (taskRows.length > 0) task = taskRows[0];
    }

    // Checkout target branch before execution
    const targetBranch = task?.headBranch || agent.defaultBranch;
    if (targetBranch) {
      console.log(
        `[agent-runtime] checkoutBranch: ${resolvedPath} → ${targetBranch}`,
      );
      try {
        await checkoutBranch(resolvedPath, targetBranch);
        console.log(`[agent-runtime] checkoutBranch succeeded`);
      } catch (err) {
        console.error(`[agent-runtime] checkoutBranch FAILED:`, err);
        throw err;
      }
    }

    const promptContent = buildPromptContent(prompt.content, task);

    // Build system prompt
    let systemPrompt:
      | string
      | { type: "preset"; preset: "claude_code"; append?: string }
      | undefined;
    if (agent.systemPrompt) {
      systemPrompt = {
        type: "preset" as const,
        preset: "claude_code" as const,
        append: agent.systemPrompt,
      };
    }

    const abortController = new AbortController();
    this.abortController = abortController;

    // Timeout
    this.timeoutTimer = setTimeout(() => {
      abortController.abort();
    }, PROMPT_TIMEOUT_MS);

    const startTime = Date.now();

    // Ensure the Claude Code subprocess can find git
    const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin"];
    const augmentedPath = [process.env.PATH, ...extraPaths].join(":");

    const spawnEnv = {
      ...process.env,
      PATH: augmentedPath,
    };

    const conversation = query({
      prompt: promptContent,
      options: {
        cwd: resolvedPath,
        systemPrompt,
        allowedTools: agent.allowedTools
          ? JSON.parse(agent.allowedTools)
          : undefined,
        model: agent.model || undefined,
        maxTurns: agent.maxTurns || undefined,
        permissionMode: (prompt.permissionMode || "default") as any,
        abortController,
        env: spawnEnv,
        spawnClaudeCodeProcess: (opts) => {
          console.log(
            `[agent-runtime] spawnClaudeCodeProcess: cmd=${opts.command}, args=${JSON.stringify(opts.args)}, cwd=${opts.cwd}`,
          );
          console.log(`[agent-runtime] spawn env.PATH=${opts.env.PATH}`);
          const proc = spawn(opts.command, opts.args, {
            cwd: opts.cwd,
            env: opts.env,
            stdio: ["pipe", "pipe", "pipe"],
          });
          proc.on("error", (err) => {
            console.error(`[agent-runtime] subprocess error:`, err.message);
          });
          return proc as any;
        },
        canUseTool: (toolName, input) =>
          this.handleToolApproval(prompt.id, toolName, input),
      },
    });

    let resultMessage: SDKResultMessage | null = null;
    let sessionId: string | null = null;

    console.log(
      `[agent-runtime] starting query() iteration for prompt ${prompt.id}`,
    );
    try {
      for await (const message of conversation) {
        // Capture session ID from init message
        if (
          message.type === "system" &&
          "subtype" in message &&
          message.subtype === "init"
        ) {
          sessionId = message.session_id;
          await db
            .update(prompts)
            .set({ sessionId, updatedAt: new Date().toISOString() })
            .where(eq(prompts.id, prompt.id));
        }

        // Stream to SSE clients
        sendOutput(prompt.id, message);

        // Capture result
        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }
      }
    } catch (err: any) {
      console.error(
        `[agent-runtime] query() iteration error for prompt ${prompt.id}:`,
        err?.message || err,
        err?.code,
      );
      // Check if aborted (cancelled or timeout)
      if (abortController.signal.aborted) {
        const current = await db
          .select({ status: prompts.status })
          .from(prompts)
          .where(eq(prompts.id, prompt.id));

        // If already marked cancelled/timeout by cancel(), don't overwrite
        if (
          current.length > 0 &&
          current[0].status !== "cancelled" &&
          current[0].status !== "timeout"
        ) {
          const durationMs = Date.now() - startTime;
          await db
            .update(prompts)
            .set({
              status: "timeout",
              errorMessage: "Prompt execution timed out",
              durationMs,
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            })
            .where(eq(prompts.id, prompt.id));
        }
        broadcast("prompt");
        return;
      }
      throw err;
    }

    const durationMs = Date.now() - startTime;

    // Success or error result
    if (resultMessage) {
      if (resultMessage.subtype === "success") {
        await db
          .update(prompts)
          .set({
            status: "done",
            output: resultMessage.result,
            costUsd: resultMessage.total_cost_usd?.toString() ?? null,
            durationMs,
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          })
          .where(eq(prompts.id, prompt.id));
      } else {
        await db
          .update(prompts)
          .set({
            status: "failed",
            errorMessage:
              "errors" in resultMessage
                ? resultMessage.errors?.join("; ")
                : "Execution error",
            costUsd: resultMessage.total_cost_usd?.toString() ?? null,
            durationMs,
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          })
          .where(eq(prompts.id, prompt.id));
      }
    } else {
      // No result message — mark as done with no output
      await db
        .update(prompts)
        .set({
          status: "done",
          durationMs,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        })
        .where(eq(prompts.id, prompt.id));
    }

    broadcast("prompt");
  }

  private handleToolApproval(
    promptId: number,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> {
    return new Promise(async (resolve) => {
      // Update prompt to need_input
      await db
        .update(prompts)
        .set({
          status: "need_input",
          inputRequest: JSON.stringify({ toolName, input }),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(prompts.id, promptId));

      broadcast("prompt");
      sendOutput(promptId, {
        type: "system" as const,
        subtype: "need_input" as const,
        toolName,
        input,
      } as any);

      // Store resolver — will be called when user responds
      this.pendingResolve = (response) => {
        // Update prompt back to running
        db.update(prompts)
          .set({
            status: "running",
            inputResponse: JSON.stringify(response),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(prompts.id, promptId))
          .then(() => {
            broadcast("prompt");
            sendOutput(promptId, {
              type: "system",
              subtype: "input_response",
              approved: response.approved,
              message: response.message,
              toolName,
            });

            if (response.approved) {
              resolve({ behavior: "allow" });
            } else {
              resolve({
                behavior: "deny",
                message: response.message || "User denied permission",
              });
            }
          });
      };
    });
  }

  respondToInput(response: { approved: boolean; message?: string }) {
    if (this.pendingResolve) {
      this.pendingResolve(response);
      this.pendingResolve = null;
    }
  }

  async cancel() {
    if (this.abortController && this.currentPromptId) {
      const promptId = this.currentPromptId;
      this.abortController.abort();

      // Mark as cancelled
      await db
        .update(prompts)
        .set({
          status: "cancelled",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        })
        .where(eq(prompts.id, promptId));

      broadcast("prompt");
    }
  }

  async stop() {
    this.polling = false;
    // Update agent status in DB
    await db
      .update(agents)
      .set({ status: "idle", updatedAt: new Date().toISOString() })
      .where(eq(agents.id, this.agentId));

    broadcast("agent");
  }

  wake() {
    this.wakeResolve?.();
  }

  getCurrentPromptId() {
    return this.currentPromptId;
  }
}

async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  const result = await runGit(cwd, ["checkout", branch]);
  if (result.exitCode !== 0) {
    throw new Error(`git checkout ${branch} failed: ${result.stderr}`);
  }
}

// --- Helper functions ---

function buildPromptContent(
  content: string,
  task: typeof tasks.$inferSelect | null,
): string {
  if (!task) return content;

  const parts: string[] = ["## Task Context"];
  parts.push(`- Title: ${task.title}`);
  // TODO: Add more context here?
  parts.push("");
  parts.push("## Instructions");
  parts.push(content);

  return parts.join("\n");
}

function sendOutput(promptId: number, message: SDKMessage | any) {
  // Buffer message for late-connecting clients
  let buffer = outputBuffers.get(promptId);
  if (!buffer) {
    buffer = [];
    outputBuffers.set(promptId, buffer);
  }
  buffer.push(message);

  const clients = outputClients.get(promptId);
  if (!clients || clients.size === 0) return;

  const data = JSON.stringify(message);
  const sseMessage = `data: ${data}\n\n`;
  const encoded = new TextEncoder().encode(sseMessage);

  for (const client of clients) {
    if (client.closed) continue;
    try {
      client.controller.enqueue(encoded);
    } catch {
      client.closed = true;
      clients.delete(client);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Exported functions ---

export function startAgent(agentId: number) {
  if (runners.has(agentId)) return;

  const runner = new AgentRunner(agentId);
  runners.set(agentId, runner);
  runner.start().finally(() => {
    runners.delete(agentId);
  });
}

export async function stopAgent(agentId: number) {
  const runner = runners.get(agentId);
  if (runner) {
    await runner.stop();
  } else {
    // Not running in-memory, just update DB
    await db
      .update(agents)
      .set({ status: "idle", updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agentId));

    broadcast("agent");
  }
}

export function wakeAgent(agentId: number) {
  runners.get(agentId)?.wake();
}

export function cancelPrompt(promptId: number) {
  for (const runner of runners.values()) {
    if (runner.getCurrentPromptId() === promptId) {
      runner.cancel();
      return;
    }
  }
}

export function respondToPrompt(
  promptId: number,
  response: { approved: boolean; message?: string },
) {
  for (const runner of runners.values()) {
    if (runner.getCurrentPromptId() === promptId) {
      runner.respondToInput(response);
      return;
    }
  }
}

export function addOutputClient(promptId: number, client: SSEClient) {
  // Flush an SSE comment to fully establish the connection
  try {
    client.controller.enqueue(new TextEncoder().encode(": ok\n\n"));
  } catch {
    client.closed = true;
    return;
  }

  // Replay buffered messages to the new client
  const buffer = outputBuffers.get(promptId);
  if (buffer) {
    for (const message of buffer) {
      const data = JSON.stringify(message);
      const sseMessage = `data: ${data}\n\n`;
      const encoded = new TextEncoder().encode(sseMessage);
      try {
        client.controller.enqueue(encoded);
      } catch {
        client.closed = true;
        return;
      }
    }
  }

  let clients = outputClients.get(promptId);
  if (!clients) {
    clients = new Set();
    outputClients.set(promptId, clients);
  }
  clients.add(client);
}

export function clearOutputBuffer(promptId: number) {
  outputBuffers.delete(promptId);
}

export function removeOutputClient(promptId: number, client: SSEClient) {
  const clients = outputClients.get(promptId);
  if (clients) {
    clients.delete(client);
    if (clients.size === 0) {
      outputClients.delete(promptId);
    }
  }
}
