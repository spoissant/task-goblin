// Follows the base-branch build of each merged PR's merge commit: green closes
// the loop (and approves front-monorepo release PRs), red starts a sprint-red
// session, and a build that never shows up times out after a day.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, repositories, tasks } from "../../db/schema";
import type { BaseBuildState } from "@/shared/merge";
import { resolveChoreModel } from "@/shared/chore-models";
import { buildForCommit, mapBuildState, pipelineFor } from "../lib/buildkite-client";
import { getChoreModelDefaults } from "../lib/chore-models";
import { AppError } from "../lib/errors";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { startChoreSession } from "./claude-sessions";
import { getMergeGitHub, type ActionsRun, type MergeGitHub, type PrTarget } from "./merge-github";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;

export const WATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const SPRINT_RED_CHORE = "sprint-red";
const BUILDKITE_BASE_BRANCH = "sprint";
const RELEASE_REPO = "front-monorepo";

interface BuildResult {
  state: BaseBuildState;
  url: string | null;
}

/** Actions runs of one commit: red if any failed, green once all completed. */
export function actionsBuildState(runs: ActionsRun[]): BaseBuildState {
  if (runs.length === 0) return "missing";
  if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) return "failed";
  return runs.every((r) => r.status === "completed") ? "passed" : "pending";
}

async function resolveBuild(task: TaskRow, repo: RepoRow, gh: MergeGitHub): Promise<BuildResult> {
  const sha = task.mergeCommitSha ?? "";
  const pipeline = pipelineFor(repo.repo);
  if (pipeline) {
    const build = await buildForCommit(pipeline, BUILDKITE_BASE_BRANCH, sha);
    return { state: mapBuildState(build?.state ?? null), url: build?.webUrl ?? null };
  }
  const runs = await gh.runsForSha(repo.owner, repo.repo, sha);
  const failed = runs.find((r) => r.conclusion === "failure" || r.conclusion === "timed_out");
  return { state: actionsBuildState(runs), url: (failed ?? runs[0])?.htmlUrl ?? null };
}

/** `publish-<project>-<bump>` → `<project>`; null for any other label. */
export function publishProject(label: string): string | null {
  const m = /^publish-(.+)-(major|minor|patch)$/.exec(label);
  return m ? m[1] : null;
}

/**
 * The bot opens one release PR per publish label, titled
 * `chore: publish <project>-<version> [publish-<project>-<bump>]`, with
 * auto-merge on: one approval ships it.
 */
export async function approveReleasePrs(gh: MergeGitHub, target: PrTarget): Promise<number[]> {
  const projects = (await gh.prLabels(target)).map(publishProject).filter((p): p is string => p !== null);
  if (projects.length === 0) return [];
  const releasePrs = await gh.openReleasePrs(target.owner, target.repo);
  const approved: number[] = [];
  for (const project of projects) {
    for (const pr of releasePrs) {
      if (pr.approvedByMe || approved.includes(pr.number) || !pr.title.includes(`[publish-${project}-`)) continue;
      await gh.approvePr({ owner: target.owner, repo: target.repo, number: pr.number });
      approved.push(pr.number);
    }
  }
  return approved;
}

/** One sprint-red session per task, ever; a 409 means another session is already on it. */
async function startSprintRed(taskId: number): Promise<void> {
  const existing = await db
    .select({ id: claudeSessions.id })
    .from(claudeSessions)
    .where(and(eq(claudeSessions.taskId, taskId), eq(claudeSessions.choreKey, SPRINT_RED_CHORE)))
    .limit(1);
  if (existing.length > 0) return;
  const model = resolveChoreModel(await getChoreModelDefaults(), SPRINT_RED_CHORE);
  try {
    await startChoreSession(taskId, SPRINT_RED_CHORE, { trigger: "auto", ...model });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) return;
    throw err;
  }
}

function timedOut(task: TaskRow): boolean {
  const since = Date.parse(task.prSyncedAt ?? task.updatedAt);
  return Number.isFinite(since) && Date.now() - since > WATCH_TIMEOUT_MS;
}

type TaskPatch = Partial<Pick<TaskRow, "baseBuildState" | "baseBuildUrl" | "mergeVerifiedAt">>;

async function writeTask(taskId: number, patch: TaskPatch): Promise<void> {
  await db.update(tasks).set({ ...patch, updatedAt: now() }).where(eq(tasks.id, taskId));
  broadcast("task", { taskId });
}

async function watchTask(task: TaskRow, repo: RepoRow, gh: MergeGitHub): Promise<void> {
  const build = await resolveBuild(task, repo, gh);
  const patch: TaskPatch = { baseBuildState: build.state, baseBuildUrl: build.url };
  if (build.state === "passed") {
    if (repo.repo === RELEASE_REPO) {
      await approveReleasePrs(gh, { owner: repo.owner, repo: repo.repo, number: task.prNumber ?? 0 });
    }
    patch.mergeVerifiedAt = now();
  } else if (build.state === "failed") {
    await startSprintRed(task.id);
    patch.mergeVerifiedAt = now();
  } else if (timedOut(task)) {
    patch.baseBuildState = "missing";
    patch.mergeVerifiedAt = now();
  } else if (build.state === task.baseBuildState && build.url === task.baseBuildUrl) {
    return;
  }
  await writeTask(task.id, patch);
}

/** Follow the base-branch build of each merged PR's merge commit. */
export async function runMergeWatch(): Promise<void> {
  const gh = getMergeGitHub();
  const rows = await db
    .select({ task: tasks, repo: repositories })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(and(eq(tasks.prState, "merged"), isNotNull(tasks.mergeCommitSha), isNull(tasks.mergeVerifiedAt)));
  for (const { task, repo } of rows) {
    try {
      await watchTask(task, repo, gh);
    } catch (err) {
      console.error(`[merge-watch] task ${task.id} failed`, err instanceof Error ? err.message : err);
    }
  }
}
