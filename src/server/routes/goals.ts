import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { goals, tasks } from "../../db/schema";
import { json, created, noContent } from "../response";
import { NotFoundError, ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { getCompletedCondition } from "../lib/task-status";
import type { Routes } from "../router";

function requiredName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError("name is required");
  return value.trim();
}

function optionalContext(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError("context must be a string");
  return value.trim() || null;
}

async function getGoalOrThrow(id: number) {
  const rows = await db.select().from(goals).where(eq(goals.id, id));
  if (rows.length === 0) throw new NotFoundError("Goal", id);
  return rows[0];
}

/** Per-goal task totals and completed counts, across the whole tasks table. */
async function countTasksByGoal(): Promise<Map<number, { taskCount: number; doneCount: number }>> {
  const completed = await getCompletedCondition();
  const rows = await db
    .select({
      goalId: tasks.goalId,
      taskCount: sql<number>`count(*)`,
      doneCount: sql<number>`sum(CASE WHEN ${completed} THEN 1 ELSE 0 END)`,
    })
    .from(tasks)
    .where(sql`${tasks.goalId} IS NOT NULL`)
    .groupBy(tasks.goalId);
  const counts = new Map<number, { taskCount: number; doneCount: number }>();
  for (const row of rows) {
    if (row.goalId !== null) counts.set(row.goalId, { taskCount: row.taskCount, doneCount: row.doneCount ?? 0 });
  }
  return counts;
}

export const goalRoutes: Routes = {
  "/api/v1/goals": {
    // Active goals in display order, with progress. ?archived=true lists the archived ones instead.
    async GET(req) {
      const archived = new URL(req.url).searchParams.get("archived") === "true";
      const rows = await db
        .select()
        .from(goals)
        .where(eq(goals.archived, archived ? 1 : 0))
        .orderBy(goals.displayOrder, goals.id);
      const counts = await countTasksByGoal();
      const items = rows.map((goal) => ({ ...goal, ...(counts.get(goal.id) ?? { taskCount: 0, doneCount: 0 }) }));
      return json({ items, total: items.length });
    },

    // New goals go last.
    async POST(req) {
      const body = await getBody(req);
      const name = requiredName(body.name);
      const context = optionalContext(body.context);
      const last = await db.select({ max: sql<number | null>`max(${goals.displayOrder})` }).from(goals);
      const timestamp = now();
      const result = await db
        .insert(goals)
        .values({ name, context, displayOrder: (last[0]?.max ?? -1) + 1, createdAt: timestamp, updatedAt: timestamp })
        .returning();
      return created(result[0]);
    },
  },

  // Section order on the Tasks page: the given goal IDs, first to last.
  "/api/v1/goals/order": {
    async PUT(req) {
      const body = await getBody(req);
      const ids: unknown = body.ids;
      if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
        throw new ValidationError("ids must be an array of goal IDs");
      }
      const timestamp = now();
      for (const [index, id] of (ids as number[]).entries()) {
        await db.update(goals).set({ displayOrder: index, updatedAt: timestamp }).where(eq(goals.id, id));
      }
      return noContent();
    },
  },

  "/api/v1/goals/:id": {
    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);
      const existing = await getGoalOrThrow(id);

      const updates: Partial<typeof goals.$inferInsert> = {};
      if ("name" in body) updates.name = requiredName(body.name);
      if ("context" in body) updates.context = optionalContext(body.context);
      if ("archived" in body) updates.archived = body.archived ? 1 : 0;
      if (Object.keys(updates).length === 0) return json(existing);

      updates.updatedAt = now();
      const result = await db.update(goals).set(updates).where(eq(goals.id, id)).returning();
      return json(result[0]);
    },

    // Deleting a goal unassigns its tasks (done here: SQLite foreign keys are off by default).
    async DELETE(_req, params) {
      const id = parseId(params.id);
      await getGoalOrThrow(id);
      await db.update(tasks).set({ goalId: null }).where(eq(tasks.goalId, id));
      await db.delete(goals).where(eq(goals.id, id));
      return noContent();
    },
  },
};
