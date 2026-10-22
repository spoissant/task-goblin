// Records which Ready to Merge PRs pass every gate (an empty hold: the task's
// Merge button shows) and why the others are held. Runs at the end of every
// sync, so it reads the task row rather than GitHub for the PR state. Nothing
// merges on its own: the Merge button squash-merges via mergeTaskPr.
import { and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks } from "../../db/schema";
import type { HoldReason, MergeHold } from "@/shared/merge";
import { parseMergeHold } from "@/shared/merge";
import { parseReviewStatus } from "@/shared/review-status";
import { getStatusCategories } from "../lib/task-status";
import { AppError, NotFoundError } from "../lib/errors";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { getMergeGitHub, type MergeGitHub, type PrTarget, type PullFile } from "./merge-github";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;

export const READY_TO_MERGE_CATEGORY = "Ready to Merge";

export const normalize = (status: string | null | undefined) => (status ?? "").toLowerCase().replace(/_/g, " ");

/** Lower-cased status names (category name + Jira mappings) of the Ready to Merge category. */
export async function readyToMergeStatuses(): Promise<Set<string>> {
  const categories = await getStatusCategories();
  const cat = categories.find((c) => c.name === READY_TO_MERGE_CATEGORY);
  return new Set(cat ? [cat.name, ...cat.jiraMappings].map(normalize) : []);
}

/** The holds the task row itself shows; pins need GitHub and come after. */
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

type TaskPatch = Partial<Pick<TaskRow, "mergeHold" | "prState" | "mergeCommitSha">>;

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
}

/** A hivetests PR on a branch an alumni_connect task also has (its hermetic specs): it merges with that PR. */
async function hasAlumniConnectBranch(task: TaskRow, repo: RepoRow): Promise<boolean> {
  if (repo.repo !== "hivetests" || !task.headBranch) return false;
  const [match] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(and(eq(repositories.repo, "alumni_connect"), eq(tasks.headBranch, task.headBranch)))
    .limit(1);
  return match !== undefined;
}

const targetOf = (task: TaskRow, repo: RepoRow): PrTarget => ({ owner: repo.owner, repo: repo.repo, number: task.prNumber ?? 0 });

/** Every hold on a PR: the row's first, then the alumni_connect pairing and a prerelease pin (one GitHub call), once the row is clear. */
async function holdReasons(task: TaskRow, repo: RepoRow, ctx: GateContext): Promise<HoldReason[]> {
  const reasons = evaluateTaskGate(task, ctx.ready);
  if (reasons.length === 0 && (await hasAlumniConnectBranch(task, repo))) reasons.push("alumni-connect-branch");
  if (reasons.length === 0 && findPrereleasePins(await ctx.gh.listPullFiles(targetOf(task, repo))).length > 0) {
    reasons.push("prerelease-pin");
  }
  return reasons;
}

/** A Ready to Merge PR: record its holds; none means its Merge button shows. */
async function gateTask(task: TaskRow, repo: RepoRow, ctx: GateContext): Promise<void> {
  await writeHoldIfChanged(task, await holdReasons(task, repo, ctx));
}

type TaskWithRepo = { task: TaskRow; repo: RepoRow | null };

/** Open PRs that are or might be gated, plus rows carrying a hold to clear. */
async function loadGateRows(): Promise<TaskWithRepo[]> {
  const openPr = and(eq(tasks.prState, "open"), isNotNull(tasks.prNumber), isNotNull(tasks.repositoryId));
  const rows = await db
    .select({ task: tasks, repo: repositories })
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(or(openPr, isNotNull(tasks.mergeHold)));
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

async function processRow({ task, repo }: TaskWithRepo, ctx: GateContext): Promise<void> {
  const candidate = isCandidate(task, ctx.ready);
  if (candidate && repo) {
    await gateTask(task, repo, ctx);
  } else if (!candidate && task.mergeHold) {
    await writeTask(task.id, { mergeHold: null });
  }
}

/** Record which Ready to Merge PRs pass every gate and why the others are held. */
export async function runMergeGate(): Promise<void> {
  const ready = await readyToMergeStatuses();
  if (ready.size === 0) return;
  const ctx: GateContext = { gh: getMergeGitHub(), ready };
  for (const row of await loadGateRows()) {
    try {
      await processRow(row, ctx);
    } catch (err) {
      console.error(`[merge-gate] task ${row.task.id} failed`, err instanceof Error ? err.message : err);
    }
  }
}

/** The Merge button: re-check the gate on the task row, then squash-merge the PR. */
export async function mergeTaskPr(taskId: number): Promise<TaskRow> {
  const [row] = await db
    .select({ task: tasks, repo: repositories })
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(eq(tasks.id, taskId));
  if (!row) throw new NotFoundError("Task", taskId);
  const { task, repo } = row;
  if (!repo || task.prState !== "open" || task.prNumber == null) {
    throw new AppError("Task has no open PR", 400, "NO_OPEN_PR");
  }
  const ctx: GateContext = { gh: getMergeGitHub(), ready: await readyToMergeStatuses() };
  const reasons = await holdReasons(task, repo, ctx);
  if (reasons.length > 0) {
    await writeHoldIfChanged(task, reasons);
    throw new AppError(`Not ready to merge: ${reasons.join(", ")}`, 409, "MERGE_HELD");
  }
  const { sha } = await ctx.gh.mergePr(targetOf(task, repo));
  // The merge watch follows the merge commit's build; the next sync fills in the rest.
  const patch: TaskPatch = { prState: "merged", mergeCommitSha: sha, mergeHold: null };
  await writeTask(task.id, patch);
  return { ...task, ...patch };
}
