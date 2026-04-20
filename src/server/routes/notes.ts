import { eq, like, or, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { notes, noteTasks, tasks } from "../../db/schema";
import { json, created, noContent } from "../response";
import { ValidationError } from "../lib/errors";
import { now } from "../lib/timestamp";
import { getBody } from "../lib/request";
import { parseId } from "../lib/validation";
import { getNoteOrThrow } from "../lib/queries";
import type { Routes } from "../router";

export const noteRoutes: Routes = {
  "/api/v1/notes": {
    async GET(req) {
      const url = new URL(req.url);
      const q = url.searchParams.get("q");
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      const whereClause = q
        ? or(like(notes.title, `%${q}%`), like(notes.content, `%${q}%`))
        : undefined;

      let query = db.select().from(notes);
      if (whereClause) query = query.where(whereClause) as typeof query;
      query = query.orderBy(desc(notes.updatedAt)).limit(limit).offset(offset) as typeof query;

      let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(notes);
      if (whereClause) countQuery = countQuery.where(whereClause) as typeof countQuery;

      const [items, countResult] = await Promise.all([query, countQuery]);
      const total = countResult[0]?.count ?? 0;

      return json({ items, total, limit, offset });
    },

    async POST(req) {
      const body = await getBody(req);

      if (!body.title || typeof body.title !== "string") {
        throw new ValidationError("title is required");
      }

      const timestamp = now();

      const result = await db
        .insert(notes)
        .values({
          title: body.title,
          content: body.content || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      const note = result[0];

      // Link tasks if provided
      if (Array.isArray(body.taskIds) && body.taskIds.length > 0) {
        await db.insert(noteTasks).values(
          body.taskIds.map((taskId: number) => ({
            noteId: note.id,
            taskId,
          }))
        );
      }

      return created(note);
    },
  },

  "/api/v1/notes/:id": {
    async GET(_req, params) {
      const id = parseId(params.id);
      const note = await getNoteOrThrow(id);

      // Get linked tasks
      const linkedTasks = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          jiraKey: tasks.jiraKey,
        })
        .from(noteTasks)
        .innerJoin(tasks, eq(noteTasks.taskId, tasks.id))
        .where(eq(noteTasks.noteId, id));

      return json({ ...note, tasks: linkedTasks });
    },

    async PATCH(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      await getNoteOrThrow(id);

      const updates: Record<string, unknown> = { updatedAt: now() };
      if ("title" in body) updates.title = body.title;
      if ("content" in body) updates.content = body.content;

      const result = await db
        .update(notes)
        .set(updates)
        .where(eq(notes.id, id))
        .returning();

      return json(result[0]);
    },

    async DELETE(_req, params) {
      const id = parseId(params.id);

      await getNoteOrThrow(id);

      // Cascade delete handled by FK constraint, but explicitly delete junctions for clarity
      await db.delete(noteTasks).where(eq(noteTasks.noteId, id));
      await db.delete(notes).where(eq(notes.id, id));

      return noContent();
    },
  },

  "/api/v1/tasks/:taskId/notes": {
    async GET(_req, params) {
      const taskId = parseId(params.taskId, "taskId");

      // Get all notes linked to this task
      const linkedNotes = await db
        .select({
          id: notes.id,
          title: notes.title,
          content: notes.content,
          createdAt: notes.createdAt,
          updatedAt: notes.updatedAt,
        })
        .from(noteTasks)
        .innerJoin(notes, eq(noteTasks.noteId, notes.id))
        .where(eq(noteTasks.taskId, taskId))
        .orderBy(desc(notes.updatedAt));

      return json({ items: linkedNotes, total: linkedNotes.length });
    },
  },

  "/api/v1/notes/:id/tasks": {
    async PUT(req, params) {
      const id = parseId(params.id);
      const body = await getBody(req);

      await getNoteOrThrow(id);

      if (!Array.isArray(body.taskIds)) {
        throw new ValidationError("taskIds must be an array");
      }

      // Delete existing links
      await db.delete(noteTasks).where(eq(noteTasks.noteId, id));

      // Insert new links
      if (body.taskIds.length > 0) {
        await db.insert(noteTasks).values(
          body.taskIds.map((taskId: number) => ({
            noteId: id,
            taskId,
          }))
        );
      }

      // Update note timestamp
      await db
        .update(notes)
        .set({ updatedAt: now() })
        .where(eq(notes.id, id));

      // Return updated note with tasks
      const linkedTasks = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          jiraKey: tasks.jiraKey,
        })
        .from(noteTasks)
        .innerJoin(tasks, eq(noteTasks.taskId, tasks.id))
        .where(eq(noteTasks.noteId, id));

      const updatedNote = await db.select().from(notes).where(eq(notes.id, id));

      return json({ ...updatedNote[0], tasks: linkedTasks });
    },
  },
};
