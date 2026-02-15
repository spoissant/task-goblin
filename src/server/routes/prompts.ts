import { eq, and, sql, asc } from "drizzle-orm";
import { db } from "../../db";
import { prompts, repositories } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError, AppError } from "../lib/errors";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { cancelPrompt, respondToPrompt } from "../services/agent-runtime";
import type { Routes } from "../router";

export const promptRoutes: Routes = {
  "/api/v1/repositories/:repositoryId/prompts": {
    async GET(req, params) {
      const repositoryId = parseId(params.repositoryId, "repositoryId");

      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repositoryId));
      if (repo.length === 0) throw new NotFoundError("Repository", repositoryId);

      const url = new URL(req.url);
      const status = url.searchParams.get("status");

      let items;
      if (status) {
        items = await db
          .select()
          .from(prompts)
          .where(
            and(
              eq(prompts.repositoryId, repositoryId),
              eq(prompts.status, status)
            )
          )
          .orderBy(asc(prompts.position), asc(prompts.id));
      } else {
        items = await db
          .select()
          .from(prompts)
          .where(eq(prompts.repositoryId, repositoryId))
          .orderBy(asc(prompts.position), asc(prompts.id));
      }

      return json({ items: items.map(({ messages, ...rest }) => rest), total: items.length });
    },

    async POST(req, params) {
      const repositoryId = parseId(params.repositoryId, "repositoryId");
      const body = await getBody(req);

      if (!body.content || typeof body.content !== "string") {
        throw new ValidationError("content is required");
      }

      const repo = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repositoryId));
      if (repo.length === 0) throw new NotFoundError("Repository", repositoryId);

      // Auto-assign position: max + 1
      const maxPos = await db
        .select({ max: sql<number>`coalesce(max(position), 0)` })
        .from(prompts)
        .where(
          and(
            eq(prompts.repositoryId, repositoryId),
            eq(prompts.status, "pending")
          )
        );

      const now = new Date().toISOString();
      const result = await db
        .insert(prompts)
        .values({
          repositoryId,
          taskId: body.taskId ?? null,
          content: body.content,
          permissionMode: body.permissionMode ?? "default",
          position: body.position ?? (maxPos[0]?.max ?? 0) + 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/prompts/:id": {
    async GET(req, params) {
      const id = parseId(params.id);
      const result = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      if (result.length === 0) throw new NotFoundError("Prompt", id);
      return json(result[0]);
    },

    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      if (existing.length === 0) throw new NotFoundError("Prompt", id);

      const status = existing[0].status;
      const editableStatuses = ["pending", "need_input"];

      // permissionMode can be updated when pending or need_input
      if (body.permissionMode !== undefined && editableStatuses.includes(status)) {
        // allowed
      } else if (status !== "pending") {
        throw new AppError(
          "Can only update pending prompts",
          409,
          "INVALID_STATUS"
        );
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (body.content !== undefined && status === "pending") updates.content = body.content;
      if (body.position !== undefined && status === "pending") updates.position = body.position;
      if (body.taskId !== undefined && status === "pending") updates.taskId = body.taskId;
      if (body.permissionMode !== undefined) updates.permissionMode = body.permissionMode;

      const result = await db
        .update(prompts)
        .set(updates)
        .where(eq(prompts.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      if (existing.length === 0) throw new NotFoundError("Prompt", id);

      if (existing[0].status === "running") {
        throw new AppError(
          "Cannot delete a running prompt",
          409,
          "PROMPT_RUNNING"
        );
      }

      await db.delete(prompts).where(eq(prompts.id, id));
      return noContent();
    },
  },

  "/api/v1/prompts/:id/cancel": {
    async POST(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      if (existing.length === 0) throw new NotFoundError("Prompt", id);

      const { status } = existing[0];
      if (status === "done" || status === "cancelled") {
        throw new AppError(
          `Cannot cancel a ${status} prompt`,
          409,
          "INVALID_STATUS"
        );
      }

      if (status === "running" || status === "need_input") {
        cancelPrompt(id);
      } else {
        // pending — just mark cancelled
        await db
          .update(prompts)
          .set({
            status: "cancelled",
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          })
          .where(eq(prompts.id, id));
      }

      const result = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      return json(result[0]);
    },
  },

  "/api/v1/prompts/:id/respond": {
    async POST(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      const existing = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      if (existing.length === 0) throw new NotFoundError("Prompt", id);

      if (existing[0].status !== "need_input") {
        throw new AppError(
          "Prompt is not awaiting input",
          409,
          "INVALID_STATUS"
        );
      }

      if (typeof body.approved !== "boolean") {
        throw new ValidationError("approved (boolean) is required");
      }

      respondToPrompt(id, { approved: body.approved, message: body.message });

      const result = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      return json(result[0]);
    },
  },

  "/api/v1/prompts/:id/retry": {
    async POST(req, params) {
      const id = parseId(params.id);

      const existing = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id));
      if (existing.length === 0) throw new NotFoundError("Prompt", id);

      const retryable = ["failed", "timeout", "cancelled"];
      if (!retryable.includes(existing[0].status)) {
        throw new AppError(
          `Cannot retry a ${existing[0].status} prompt`,
          409,
          "INVALID_STATUS"
        );
      }

      const now = new Date().toISOString();
      const result = await db
        .update(prompts)
        .set({
          status: "pending",
          agentId: null,
          output: null,
          errorMessage: null,
          sessionId: null,
          costUsd: null,
          durationMs: null,
          inputRequest: null,
          inputResponse: null,
          messages: null,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        })
        .where(eq(prompts.id, id))
        .returning();

      return json(result[0]);
    },
  },
};
