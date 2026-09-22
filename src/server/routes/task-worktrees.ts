import { and, eq, isNotNull, like, sql } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import { json } from "../response";
import { NotFoundError } from "../lib/errors";
import { parseId } from "../lib/validation";
import { getTaskOrThrow } from "../lib/queries";
import {
  getTaskWorktreeStatus,
  removeTaskWorktree,
  startTaskWorktreePreparation,
} from "../services/task-worktrees";
import type { RepositoryGuess } from "../../shared/types";
import type { Routes } from "../router";

// Title fragments that point at a specific repository (matched case-insensitively).
const TITLE_KEYWORDS: Record<string, string[]> = {
  "front-monorepo": ["front-monorepo", "tiptap", "hbeditor", "hb-editor", "@hivebrite/"],
  alumni_connect: ["alumni_connect", "alumni connect", "cucumber", "rspec", "sidekiq", "rails"],
};

export async function guessRepository(taskId: number): Promise<RepositoryGuess> {
  const task = await getTaskOrThrow(taskId);
  const repos = await db.select().from(repositories).where(eq(repositories.enabled, 1));
  const byName = new Map(repos.map((r) => [r.repo, r.id]));

  const title = task.title.toLowerCase();
  for (const [repoName, keywords] of Object.entries(TITLE_KEYWORDS)) {
    const id = byName.get(repoName);
    if (id && keywords.some((kw) => title.includes(kw))) {
      return { repositoryId: id, reason: "title-keyword", candidates: [] };
    }
  }

  if (task.jiraKey) {
    const project = task.jiraKey.split("-")[0];
    const rows = await db
      .select({ repositoryId: tasks.repositoryId, count: sql<number>`count(*)` })
      .from(tasks)
      .where(and(like(tasks.jiraKey, `${project}-%`), isNotNull(tasks.repositoryId)))
      .groupBy(tasks.repositoryId)
      .orderBy(sql`count(*) desc`);
    const candidates = rows
      .filter((r) => r.repositoryId !== null)
      .map((r) => ({ repositoryId: r.repositoryId!, count: r.count }));
    if (candidates.length > 0) {
      return { repositoryId: candidates[0].repositoryId, reason: "jira-project", candidates };
    }
  }

  if (repos.length === 1) {
    return { repositoryId: repos[0].id, reason: "only-enabled-repo", candidates: [] };
  }
  return { repositoryId: null, reason: null, candidates: [] };
}

export const taskWorktreeRoutes: Routes = {
  "/api/v1/tasks/:id/worktree": {
    async GET(_req, params) {
      const id = parseId(params.id);
      await getTaskOrThrow(id);
      return json(await getTaskWorktreeStatus(id));
    },

    // Prepare the worktree without starting a session.
    async POST(_req, params) {
      const id = parseId(params.id);
      const row = await startTaskWorktreePreparation(id);
      return json(row, 202);
    },

    async DELETE(req, params) {
      const id = parseId(params.id);
      const force = new URL(req.url).searchParams.get("force") === "true";
      const row = await removeTaskWorktree(id, { force });
      return json(row, 202);
    },
  },

  "/api/v1/tasks/:id/repository-guess": {
    async GET(_req, params) {
      const id = parseId(params.id);
      const guess = await guessRepository(id);
      if (!guess) throw new NotFoundError("Task", id);
      return json(guess);
    },
  },
};
