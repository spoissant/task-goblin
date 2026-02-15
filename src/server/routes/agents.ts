import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { agents, worktrees, prompts } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError, AppError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { startAgent, stopAgent, wakeAgent } from "../services/agent-runtime";
import { now } from "../lib/timestamp";
import type { Routes } from "../router";

async function getAgentWithWorktree(agentId: number) {
  const result = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: { worktree: { with: { repository: true } } },
  });

  return result ?? null;
}

export const agentRoutes: Routes = {
  "/api/v1/agents": {
    async GET() {
      const items = await db.query.agents.findMany({
        with: { worktree: { with: { repository: true } } },
      });

      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.name || typeof body.name !== "string") {
        throw new ValidationError("name is required");
      }
      if (!body.worktreeId || typeof body.worktreeId !== "number") {
        throw new ValidationError("worktreeId is required and must be a number");
      }

      // Verify worktree exists
      const wt = await db
        .select()
        .from(worktrees)
        .where(eq(worktrees.id, body.worktreeId));
      if (wt.length === 0) {
        throw new NotFoundError("Worktree", body.worktreeId);
      }

      // Check uniqueness (1-to-1 with worktree)
      const existing = await db
        .select()
        .from(agents)
        .where(eq(agents.worktreeId, body.worktreeId));
      if (existing.length > 0) {
        throw new AppError(
          "An agent already exists for this worktree",
          409,
          "CONFLICT"
        );
      }

      const timestamp = now();
      const result = await db
        .insert(agents)
        .values({
          name: body.name,
          worktreeId: body.worktreeId,
          systemPrompt: body.systemPrompt ?? null,
          allowedTools: body.allowedTools
            ? JSON.stringify(body.allowedTools)
            : null,
          model: body.model ?? null,
          maxTurns: body.maxTurns ?? null,
          defaultBranch: body.defaultBranch ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/agents/:id": {
    async GET(req, params) {
      const id = parseId(params.id);
      const agent = await getAgentWithWorktree(id);
      if (!agent) throw new NotFoundError("Agent", id);
      return json(agent);
    },

    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      if (existing.length === 0) throw new NotFoundError("Agent", id);

      if (existing[0].status === "running") {
        throw new AppError(
          "Cannot update a running agent",
          409,
          "AGENT_RUNNING"
        );
      }

      const updates: Record<string, unknown> = {
        updatedAt: now(),
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt;
      if (body.allowedTools !== undefined) {
        updates.allowedTools = body.allowedTools
          ? JSON.stringify(body.allowedTools)
          : null;
      }
      if (body.model !== undefined) updates.model = body.model;
      if (body.maxTurns !== undefined) updates.maxTurns = body.maxTurns;
      if (body.defaultBranch !== undefined) updates.defaultBranch = body.defaultBranch;

      const result = await db
        .update(agents)
        .set(updates)
        .where(eq(agents.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      if (existing.length === 0) throw new NotFoundError("Agent", id);

      if (existing[0].status === "running") {
        throw new AppError(
          "Cannot delete a running agent",
          409,
          "AGENT_RUNNING"
        );
      }

      const promptCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(prompts)
        .where(eq(prompts.agentId, id));

      if (promptCount[0]?.count > 0) {
        throw new AppError(
          `Cannot delete agent: ${promptCount[0].count} prompt(s) reference it`,
          409,
          "REFERENTIAL_INTEGRITY"
        );
      }

      await db.delete(agents).where(eq(agents.id, id));
      return noContent();
    },
  },

  "/api/v1/agents/:id/start": {
    async POST(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      if (existing.length === 0) throw new NotFoundError("Agent", id);

      if (existing[0].status === "running") {
        throw new AppError("Agent is already running", 409, "AGENT_RUNNING");
      }

      await db
        .update(agents)
        .set({ status: "running", updatedAt: now() })
        .where(eq(agents.id, id));

      startAgent(id);

      const agent = await getAgentWithWorktree(id);
      return json(agent);
    },
  },

  "/api/v1/agents/:id/stop": {
    async POST(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      if (existing.length === 0) throw new NotFoundError("Agent", id);

      if (existing[0].status === "idle") {
        throw new AppError("Agent is already idle", 409, "AGENT_IDLE");
      }

      await stopAgent(id);

      const agent = await getAgentWithWorktree(id);
      return json(agent);
    },
  },

  "/api/v1/agents/:id/check": {
    async POST(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id));
      if (existing.length === 0) throw new NotFoundError("Agent", id);

      if (existing[0].status !== "running") {
        throw new AppError("Agent is not running", 409, "AGENT_NOT_RUNNING");
      }

      wakeAgent(id);
      return noContent();
    },
  },
};
