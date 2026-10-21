// Enables GitHub auto-merge (squash) on Ready to Merge PRs that pass every gate
// and records why the others are held. Runs every sync tick after the GitHub
// sync, so it reads the task row rather than GitHub for the PR state.
import { and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import type { HoldReason, MergeHold } from "@/shared/merge";
import { parseMergeHold } from "@/shared/merge";
import { parseReviewStatus } from "@/shared/review-status";
import { getStatusCategories } from "../lib/task-status";
import { BuildkiteConfigError, latestFinishedBuild, mapBuildState, pipelineFor } from "../lib/buildkite-client";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { getMergeGitHub, type ActionsRun, type MergeGitHub, type PrTarget, type PullFile } from "./merge-github";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;

export const READY_TO_MERGE_CATEGORY = "Ready to Merge";
/** alumni_connect PRs merge into sprint; Buildkite builds it. */
const BUILDKITE_BASE_BRANCH = "sprint";
const ACTIONS_CI_WORKFLOW = "CI";

export type BaseHealth = "green" | "red" | "pending" | "unknown";

const normalize = (status: string | null | undefined) => (status ?? "").toLowerCase().replace(/_/g, " ");

/** Lower-cased status names (category name + Jira mappings) of the Ready to Merge category. */
export async function readyToMergeStatuses(): Promise<Set<string>> {
  const categories = await getStatusCategories();
  const cat = categories.find((c) => c.name === READY_TO_MERGE_CATEGORY);
  return new Set(cat ? [cat.name, ...cat.jiraMappings].map(normalize) : []);
}

/** The holds the task row itself shows; base CI and pins need GitHub/Buildkite and come after. */
export function evaluateTaskGate(task: TaskRow, readyStatuses: Set<string>): HoldReason[] {
  const reasons: HoldReason[] = [];
  if (!readyStatuses.has(normalize(task.status))) reasons.push("not-ready-to-merge");
  if (task.isDraft === 1) reasons.push("draft");
  const review = parseReviewStatus(task.reviewStatus);
  if (review?.decision === "CHANGES_REQUESTED") reasons.push("changes-requested");
  else if (review?.decision !== "APPROVED") reasons.push("awaiting-approval");
  if (task.checksStatus === "failing") reasons.push("checks-failing");
  else if (task.checksStatus !== "passing") reasons.push("checks-pending");
  if (task.hasConflicts === 1) reasons.push("conflicts");
  if ((task.unresolvedCommentCount ?? 0) > 0) reasons.push("unresolved-comments");
  return reasons;
}

const PIN_FILES = /(^|\/)(package\.json|Gemfile|Gemfile\.lock|yarn\.lock)$/;
const PIN_PATTERNS = [
  /-alpha[.\d]/, // front-monorepo alpha: 1.2.3-spoissant-alpha.4
  /-spoissant/,
  /(github:|@hivebrite\/|Hivebrite\/)[^"'\s]+#[^"'\s]+/, // npm git ref: github:Hivebrite/x#branch
];
/** Gemfile SDK gems pinned to a branch build (`ref: "<sha>"`, `branch:`) instead of a release `tag:`. */
const GEMFILE_PIN = /\b(ref|branch):\s*["']/;

/** `"<file>: <added line>"` for each added manifest line that pins a prerelease. */
export function findPrereleasePins(files: PullFile[]): string[] {
  const pins: string[] = [];
  for (const file of files) {
    if (!PIN_FILES.test(file.filename) || !file.patch) continue;
    const gemfile = /Gemfile(\.lock)?$/.test(file.filename);
    for (const raw of file.patch.split("\n")) {
      if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
      const line = raw.slice(1).trim();
      if (PIN_PATTERNS.some((p) => p.test(line)) || (gemfile && GEMFILE_PIN.test(line))) {
        pins.push(`${file.filename}: ${line}`);
      }
    }
  }
  return pins;
}

/** Collapse the CI workflow's runs on one commit into a branch verdict. */
export function actionsHealth(runs: ActionsRun[]): BaseHealth {
  const ci = runs.filter((r) => r.name === ACTIONS_CI_WORKFLOW);
  if (ci.length === 0) return "unknown";
  if (ci.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) return "red";
  if (ci.some((r) => r.status !== "completed")) return "pending";
  return ci.every((r) => r.conclusion === "success") ? "green" : "unknown";
}

/** The base branch's latest build: Buildkite for alumni_connect, Actions elsewhere. */
export async function baseBranchHealth(repo: RepoRow, gh: MergeGitHub): Promise<BaseHealth> {
  const pipeline = pipelineFor(repo.repo);
  if (pipeline) {
    try {
      const state = mapBuildState((await latestFinishedBuild(pipeline, BUILDKITE_BASE_BRANCH))?.state ?? null);
      if (state === "passed") return "green";
      if (state === "failed") return "red";
      return state === "pending" ? "pending" : "unknown";
    } catch (err) {
      if (!(err instanceof BuildkiteConfigError)) console.error(`[merge-gate] Buildkite ${repo.repo} failed`, err);
      return "unknown";
    }
  }
  return actionsHealth(await gh.latestBaseRuns(repo.owner, repo.repo, repo.defaultBaseBranch ?? "main"));
}

type TaskPatch = Partial<Pick<TaskRow, "autoMergeEnabledAt" | "mergeHold">>;

async function writeTask(taskId: number, patch: TaskPatch): Promise<void> {
  await db.update(tasks).set({ ...patch, updatedAt: now() }).where(eq(tasks.id, taskId));
  broadcast("task", { taskId });
}

const sameReasons = (a: HoldReason[], b: HoldReason[] | undefined) =>
  b !== undefined && a.length === b.length && a.every((r, i) => r === b[i]);

async function writeHoldIfChanged(task: TaskRow, reasons: HoldReason[]): Promise<void> {
  if (sameReasons(reasons, parseMergeHold(task.mergeHold)?.reasons)) return;
  const hold: MergeHold = { reasons, at: now() };
  await writeTask(task.id, { mergeHold: JSON.stringify(hold) });
}

interface GateContext {
  gh: MergeGitHub;
  ready: Set<string>;
  health: (repo: RepoRow) => Promise<BaseHealth>;
}

const targetOf = (task: TaskRow, repo: RepoRow): PrTarget => ({ owner: repo.owner, repo: repo.repo, number: task.prNumber ?? 0 });

/** A Ready to Merge PR without auto-merge: enable it or record the hold. */
async function gateTask(task: TaskRow, repo: RepoRow, ctx: GateContext): Promise<void> {
  const reasons = evaluateTaskGate(task, ctx.ready);
  if (reasons.length === 0) {
    const health = await ctx.health(repo);
    if (health === "red") reasons.push("base-ci-red");
    else if (health !== "green") reasons.push("base-ci-unknown");
  }
  if (reasons.length === 0 && findPrereleasePins(await ctx.gh.listPullFiles(targetOf(task, repo))).length > 0) {
    reasons.push("prerelease-pin");
  }
  if (reasons.length > 0) {
    await writeHoldIfChanged(task, reasons);
    return;
  }
  await ctx.gh.enableAutoMerge(targetOf(task, repo));
  await writeTask(task.id, { autoMergeEnabledAt: now(), mergeHold: null });
}

/** Auto-merge is on: take it back if the task left Ready to Merge or a pin landed since. */
async function regateEnabledTask(task: TaskRow, repo: RepoRow, ctx: GateContext): Promise<void> {
  const reasons: HoldReason[] = [];
  if (!ctx.ready.has(normalize(task.status))) reasons.push("not-ready-to-merge");
  else if (findPrereleasePins(await ctx.gh.listPullFiles(targetOf(task, repo))).length > 0) reasons.push("prerelease-pin");
  if (reasons.length === 0) return;
  await ctx.gh.disableAutoMerge(targetOf(task, repo));
  const hold: MergeHold = { reasons, at: now() };
  await writeTask(task.id, { autoMergeEnabledAt: null, mergeHold: JSON.stringify(hold) });
}

type TaskWithRepo = { task: TaskRow; repo: RepoRow | null };

/** Open PRs that are, were, or might be gated: candidates plus rows carrying gate state. */
async function loadGateRows(): Promise<TaskWithRepo[]> {
  const openPr = and(eq(tasks.prState, "open"), isNotNull(tasks.prNumber), isNotNull(tasks.repositoryId));
  const rows = await db
    .select({ task: tasks, repo: repositories })
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(or(openPr, isNotNull(tasks.mergeHold), isNotNull(tasks.autoMergeEnabledAt)));
  return rows;
}

function isCandidate(task: TaskRow, ready: Set<string>): boolean {
  return (
    task.prState === "open" &&
    task.prNumber != null &&
    task.repositoryId != null &&
    (task.onIce ?? 0) === 0 &&
    ready.has(normalize(task.status))
  );
}

function memoizedHealth(gh: MergeGitHub): GateContext["health"] {
  const cache = new Map<number, Promise<BaseHealth>>();
  return (repo) => {
    let hit = cache.get(repo.id);
    if (!hit) {
      hit = baseBranchHealth(repo, gh);
      cache.set(repo.id, hit);
    }
    return hit;
  };
}

async function processRow({ task, repo }: TaskWithRepo, ctx: GateContext): Promise<void> {
  const candidate = isCandidate(task, ctx.ready);
  if (task.autoMergeEnabledAt && task.prState === "open" && repo) {
    await regateEnabledTask(task, repo, ctx);
  } else if (candidate && repo) {
    await gateTask(task, repo, ctx);
  } else if (!candidate && task.mergeHold) {
    await writeTask(task.id, { mergeHold: null });
  }
}

/** Enable GitHub auto-merge on PRs that pass every gate; record holds on the others. */
export async function runMergeGate(): Promise<void> {
  const ready = await readyToMergeStatuses();
  if (ready.size === 0) return;
  const gh = getMergeGitHub();
  const ctx: GateContext = { gh, ready, health: memoizedHealth(gh) };
  for (const row of await loadGateRows()) {
    try {
      await processRow(row, ctx);
    } catch (err) {
      console.error(`[merge-gate] task ${row.task.id} failed`, err instanceof Error ? err.message : err);
    }
  }
}
