// Follows the merge commit of each merged front-monorepo PR: once its GitHub
// Actions runs pass, approves the bot's release PRs. Passed, failed, or timed
// out after a day, the watch is done with the PR (merge_verified_at); while
// pending it writes nothing.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { getMergeGitHub, type ActionsRun, type MergeGitHub, type PrTarget } from "./merge-github";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;

export const WATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const RELEASE_REPO = "front-monorepo";

/** Actions runs of one commit: red if any failed, green once all completed, pending until then (or before any shows up). */
export function actionsBuildState(runs: ActionsRun[]): "pending" | "passed" | "failed" {
  if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) return "failed";
  return runs.length > 0 && runs.every((r) => r.status === "completed") ? "passed" : "pending";
}

/** `publish-<project>-<bump>` → `<project>`; null for any other label. */
export function publishProject(label: string): string | null {
  const m = /^publish-(.+)-(major|minor|patch)$/.exec(label);
  return m ? m[1] : null;
}

/**
 * The bot opens one release PR per publish label, titled
 * `chore: publish <project>-<version> [publish-<project>-<bump>]`, with
 * GitHub auto-merge on (the bot's, not ours): one approval ships it.
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

function timedOut(task: TaskRow): boolean {
  const since = Date.parse(task.prSyncedAt ?? task.updatedAt);
  return Number.isFinite(since) && Date.now() - since > WATCH_TIMEOUT_MS;
}

async function markVerified(taskId: number): Promise<void> {
  const timestamp = now();
  await db.update(tasks).set({ mergeVerifiedAt: timestamp, updatedAt: timestamp }).where(eq(tasks.id, taskId));
  broadcast("task");
}

async function watchTask(task: TaskRow, repo: RepoRow, gh: MergeGitHub): Promise<void> {
  const state = actionsBuildState(await gh.runsForSha(repo.owner, repo.repo, task.mergeCommitSha ?? ""));
  if (state === "passed") {
    await approveReleasePrs(gh, { owner: repo.owner, repo: repo.repo, number: task.prNumber ?? 0 });
  } else if (state === "pending" && !timedOut(task)) {
    return;
  }
  await markVerified(task.id);
}

/** Follow the merge commit of each merged front-monorepo PR the watch isn't done with. */
export async function runMergeWatch(): Promise<void> {
  const gh = getMergeGitHub();
  const rows = await db
    .select({ task: tasks, repo: repositories })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(
      and(
        eq(repositories.repo, RELEASE_REPO),
        eq(tasks.prState, "merged"),
        isNotNull(tasks.mergeCommitSha),
        isNull(tasks.mergeVerifiedAt)
      )
    );
  for (const { task, repo } of rows) {
    try {
      await watchTask(task, repo, gh);
    } catch (err) {
      console.error(`[merge-watch] task ${task.id} failed`, err instanceof Error ? err.message : err);
    }
  }
}
