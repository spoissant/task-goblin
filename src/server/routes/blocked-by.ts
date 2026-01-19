import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { blockedBy } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { Routes } from "../router";

async function getBody(req: Request) {
  return req.json();
}

export const blockedByRoutes: Routes = {
  "/api/v1/blocked-by": {
    async GET(req) {
      const url = new URL(req.url);
      const blockedTaskId = url.searchParams.get("blockedTaskId");
      const blockedBranchId = url.searchParams.get("blockedBranchId");
      const blockerTaskId = url.searchParams.get("blockerTaskId");
      const blockerTodoId = url.searchParams.get("blockerTodoId");
      const blockerBranchId = url.searchParams.get("blockerBranchId");

      const conditions = [];
      if (blockedTaskId) {
        conditions.push(eq(blockedBy.blockedTaskId, parseInt(blockedTaskId, 10)));
      }
      if (blockedBranchId) {
        conditions.push(eq(blockedBy.blockedBranchId, parseInt(blockedBranchId, 10)));
      }
      if (blockerTaskId) {
        conditions.push(eq(blockedBy.blockerTaskId, parseInt(blockerTaskId, 10)));
      }
      if (blockerTodoId) {
        conditions.push(eq(blockedBy.blockerTodoId, parseInt(blockerTodoId, 10)));
      }
      if (blockerBranchId) {
        conditions.push(eq(blockedBy.blockerBranchId, parseInt(blockerBranchId, 10)));
      }

      const items =
        conditions.length > 0
          ? await db
              .select()
              .from(blockedBy)
              .where(and(...conditions))
          : await db.select().from(blockedBy);

      return json({ items, total: items.length });
    },

    async POST(req) {
      const body = await getBody(req);

      // Validate: exactly one blocked entity must be set
      const blockedCount = [body.blockedTaskId, body.blockedBranchId].filter(
        (v) => v !== undefined && v !== null
      ).length;
      if (blockedCount !== 1) {
        throw new ValidationError(
          "Exactly one of blockedTaskId or blockedBranchId must be set"
        );
      }

      // Validate: exactly one blocker entity must be set
      const blockerCount = [
        body.blockerTaskId,
        body.blockerTodoId,
        body.blockerBranchId,
      ].filter((v) => v !== undefined && v !== null).length;
      if (blockerCount !== 1) {
        throw new ValidationError(
          "Exactly one of blockerTaskId, blockerTodoId, or blockerBranchId must be set"
        );
      }

      const result = await db
        .insert(blockedBy)
        .values({
          blockedTaskId: body.blockedTaskId || null,
          blockedBranchId: body.blockedBranchId || null,
          blockerTaskId: body.blockerTaskId || null,
          blockerTodoId: body.blockerTodoId || null,
          blockerBranchId: body.blockerBranchId || null,
        })
        .returning();

      return created(result[0]);
    },
  },

  "/api/v1/blocked-by/:id": {
    async GET(req, params) {
      const id = parseInt(params.id, 10);
      const result = await db
        .select()
        .from(blockedBy)
        .where(eq(blockedBy.id, id));

      if (result.length === 0) {
        throw new NotFoundError("BlockedBy", id);
      }

      return json(result[0]);
    },

    async DELETE(req, params) {
      const id = parseInt(params.id, 10);

      const existing = await db
        .select()
        .from(blockedBy)
        .where(eq(blockedBy.id, id));
      if (existing.length === 0) {
        throw new NotFoundError("BlockedBy", id);
      }

      await db.delete(blockedBy).where(eq(blockedBy.id, id));

      return noContent();
    },
  },
};
