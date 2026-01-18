import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { blockedBy } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import type { Routes } from "../router";

const VALID_BLOCKED_TYPES = ["task", "branch"];
const VALID_BLOCKER_TYPES = ["task", "todo", "branch"];

async function getBody(req: Request) {
  return req.json();
}

export const blockedByRoutes: Routes = {
  "/api/v1/blocked-by": {
    async GET(req) {
      const url = new URL(req.url);
      const blockedId = url.searchParams.get("blockedId");
      const blockedType = url.searchParams.get("blockedType");
      const blockerId = url.searchParams.get("blockerId");
      const blockerType = url.searchParams.get("blockerType");

      const conditions = [];
      if (blockedId) {
        conditions.push(eq(blockedBy.blockedId, parseInt(blockedId, 10)));
      }
      if (blockedType) {
        conditions.push(eq(blockedBy.blockedType, blockedType));
      }
      if (blockerId) {
        conditions.push(eq(blockedBy.blockerId, parseInt(blockerId, 10)));
      }
      if (blockerType) {
        conditions.push(eq(blockedBy.blockerType, blockerType));
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

      if (!body.blockedId || typeof body.blockedId !== "number") {
        throw new ValidationError("blockedId is required and must be a number");
      }
      if (!body.blockedType || !VALID_BLOCKED_TYPES.includes(body.blockedType)) {
        throw new ValidationError(
          `blockedType must be one of: ${VALID_BLOCKED_TYPES.join(", ")}`
        );
      }
      if (!body.blockerId || typeof body.blockerId !== "number") {
        throw new ValidationError("blockerId is required and must be a number");
      }
      if (!body.blockerType || !VALID_BLOCKER_TYPES.includes(body.blockerType)) {
        throw new ValidationError(
          `blockerType must be one of: ${VALID_BLOCKER_TYPES.join(", ")}`
        );
      }

      const result = await db
        .insert(blockedBy)
        .values({
          blockedId: body.blockedId,
          blockedType: body.blockedType,
          blockerId: body.blockerId,
          blockerType: body.blockerType,
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
