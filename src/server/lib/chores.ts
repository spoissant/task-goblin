import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { getNotCompletedCondition, getStatusCategories, statusNamesOf } from "./task-status";
import { buildRepoMap } from "./queries";
import { checksFailedAt } from "./checks";
import type { RepoPair } from "@/shared/chore-pairs";
import { parseChoreSkips } from "@/shared/chore-skips";
import { resolvePrompt, type ChoreDefinition, type ChoreEntry } from "@/shared/chores";
import { parseStringList } from "@/shared/json";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;
/** A task column, or a value computed from the task row. */
type TriggerField = keyof TaskRow | ((task: TaskRow) => unknown);

export interface Chore {
  number: number;
  key: string;
  name: string;
  condition: string;
  prompt: string; // template: {{taskId}}, {{jiraKey}}
  categories: string[] | null; // null = all active tasks; array = category names from DB
  excludeCategories?: string[]; // category names whose tasks must never match this chore
  match: (task: TaskRow, repo: RepoRow | null, parent: TaskRow | null) => boolean; // parent: the task whose jiraKey is task.parentKey
  supportsBulk?: boolean; // can be invoked with multiple task IDs at once
  requiresSameRepo?: boolean; // when supportsBulk, all selected tasks must share a repository
  cwd?: "task" | "main"; // where an AI session runs: the task's worktree (default) or the repo's main checkout
  repoPairs?: RepoPair[]; // two-repo chore: run on exactly one task per repo of a pair; the session runs on the target task
  /**
   * Set when the chore scheduler may start this chore on its own. `fields` are
   * the task columns, or values computed from the row, that define one trigger
   * state: the scheduler starts the chore once per distinct state (see
   * fingerprintFor). `prompt` replaces the chore prompt for auto-starts (e.g.
   * to pass a default env), and `when` limits them to some tasks.
   */
  auto?: { fields: TriggerField[]; prompt?: string; when?: (task: TaskRow, repo: RepoRow | null) => boolean };
}

function isOnAnyDeploymentBranch(task: TaskRow, repo: RepoRow | null): boolean {
  if (!repo) return false;
  const taskBranches = parseStringList(task.onDeploymentBranches);
  return parseStringList(repo.deploymentBranches).some((b) => taskBranches.includes(b));
}

// A hivetests sub-task's hermetic specs run against its alumni_connect parent's
// code, so its AI QA waits until the parent has a PR.
function awaitsParentPr(repo: RepoRow | null, parent: TaskRow | null): boolean {
  return repo?.repo === "hivetests" && parent !== null && parent.prNumber === null;
}

// The env auto-starts deploy to, on repos that have it; anything else is deployed by hand.
const AUTO_DEPLOY_ENV = "staging";

// Upstream repos whose releases alumni_connect pins, for the two-repo chores.
const UPSTREAM_PAIRS: RepoPair[] = [
  ["api-contracts", "alumni_connect"],
  ["front-monorepo", "alumni_connect"],
];

const CHORES: Chore[] = [
  {
    number: 1,
    key: "start-task",
    name: "Start New Task",
    condition: "status category = Backlog",
    prompt: "/chore-start-task {{taskId}}",
    categories: ["Backlog"],
    match: () => true,
  },
  {
    number: 3,
    key: "fix-merge-conflicts",
    name: "Fix Merge Conflicts",
    condition: "hasConflicts = true",
    prompt: "/chore-fix-merge-conflicts {{taskId}}",
    categories: null,
    match: (t) => t.hasConflicts === 1,
    auto: { fields: ["headSha", "baseBranch"] },
  },
  {
    number: 4,
    key: "address-pr-comments",
    name: "Address PR Comments",
    condition: "prState = open AND unresolvedCommentCount > 0",
    prompt: "/chore-address-pr-comments {{taskId}}",
    categories: null,
    match: (t) => t.prState === "open" && (t.unresolvedCommentCount ?? 0) > 0,
    auto: { fields: ["unresolvedCommentCount"] },
  },
  {
    number: 5,
    key: "fix-pr-checks",
    name: "Fix PR checks",
    condition: "prState = open AND checksStatus = failing",
    prompt: "/chore-fix-pr-checks {{taskId}}",
    categories: null,
    match: (t) => t.prState === "open" && t.checksStatus === "failing",
    // A CI re-run that fails again on the same commit is a new state.
    auto: { fields: ["headSha", (t) => checksFailedAt(t.checksDetails)] },
  },
  {
    number: 6,
    key: "continue-work",
    name: "Continue After QA",
    condition: "status category = In Progress AND prState = open AND isDraft = false",
    prompt: "/chore-continue-work {{taskId}}",
    categories: ["In Progress"],
    match: (t) => t.prState === "open" && t.isDraft === 0,
    auto: { fields: ["status", "isDraft", "headSha", "unresolvedCommentCount"] },
  },
  {
    number: 7,
    key: "ai-qa",
    name: "AI QA",
    condition: "status category = In Progress AND prState = open AND isDraft = true AND (not a hivetests sub-task OR its parent has a PR)",
    prompt: "/chore-ai-qa {{taskId}}",
    categories: ["In Progress"],
    supportsBulk: true,
    requiresSameRepo: true,
    match: (t, repo, parent) => t.prState === "open" && t.isDraft === 1 && !awaitsParentPr(repo, parent),
    auto: { fields: ["status", "headSha"] },
  },
  {
    number: 8,
    key: "code-review-pr",
    name: "Code review my PR",
    condition: "status category = Code Review AND isDraft = true",
    prompt: "/chore-code-review-my-pr {{taskId}}",
    categories: ["Code Review"],
    match: (t) => t.isDraft === 1,
    auto: { fields: ["status", "headSha"] },
  },
  {
    number: 9,
    key: "deploy-test-env",
    name: "Deploy to Test Env",
    condition: "repo has deployment branches AND prState = open AND checksStatus = passing AND unresolvedCommentCount = 0 AND isDraft = false AND hasConflicts = false AND not on any deployment branch AND status category != Ready to Merge",
    prompt: "/chore-deploy-to-test-env {{taskId}}",
    categories: null,
    excludeCategories: ["Ready to Merge"],
    supportsBulk: true,
    requiresSameRepo: true,
    cwd: "main",
    match: (t, repo) =>
      parseStringList(repo?.deploymentBranches).length > 0 &&
      t.prState === "open" &&
      t.checksStatus === "passing" &&
      (t.unresolvedCommentCount ?? 0) === 0 &&
      t.isDraft === 0 &&
      (t.hasConflicts ?? 0) === 0 &&
      !isOnAnyDeploymentBranch(t, repo),
    auto: {
      fields: ["headSha", "onDeploymentBranches"],
      prompt: `/chore-deploy-to-test-env {{taskId}} ${AUTO_DEPLOY_ENV}`,
      when: (_t, repo) => parseStringList(repo?.deploymentBranches).includes(AUTO_DEPLOY_ENV),
    },
  },
  {
    number: 10,
    key: "request-reviews",
    name: "Request Code Reviews",
    condition: "manual only (never suggested)",
    prompt: "/chore-request-reviews {{taskId}}",
    categories: null,
    supportsBulk: true,
    cwd: "main",
    match: () => false,
  },
  {
    number: 11,
    key: "explain-me-why",
    name: "Explain Me Why",
    condition: "manual only (never suggested)",
    prompt: "/chore-explain-me-why {{taskId}}",
    categories: null,
    match: () => false,
  },
  {
    number: 12,
    key: "ship-upstream",
    name: "Ship Upstream PR",
    condition: "manual only: an api-contracts or front-monorepo task selected with the alumni_connect task that depends on it",
    prompt: "/chore-ship-upstream {{taskId}}",
    categories: null,
    repoPairs: UPSTREAM_PAIRS,
    match: () => false,
  },
  {
    number: 13,
    key: "preview-upstream",
    name: "Preview Upstream PR",
    condition: "manual only: an api-contracts or front-monorepo task selected with the alumni_connect task that depends on it",
    prompt: "/chore-preview-upstream {{taskId}}",
    categories: null,
    repoPairs: UPSTREAM_PAIRS,
    match: () => false,
  },
  {
    number: 14,
    key: "validate-issue",
    name: "Validate Issue",
    condition: "manual only (never suggested)",
    prompt: "/chore-validate-issue {{taskId}}",
    categories: null,
    cwd: "main", // runs before work starts: no worktree or branch yet
    match: () => false,
  },
  {
    number: 15,
    key: "prep-dev-qa",
    name: "Prep Dev QA",
    condition: "alumni_connect AND status category = Code Review AND prState = open AND checksStatus = passing AND on a deployment branch",
    prompt: "/chore-prep-dev-qa {{taskId}}",
    categories: ["Code Review"],
    cwd: "main", // reads git objects and the test env only, no code changes
    // Unresolved comments are ignored: some stay open until the end (e.g. "bump this alpha").
    match: (t, repo) =>
      repo?.repo === "alumni_connect" &&
      t.prState === "open" &&
      t.checksStatus === "passing" &&
      isOnAnyDeploymentBranch(t, repo),
  },
];

/**
 * One string per distinct trigger state of a chore on a task: the values of
 * the chore's `auto.fields`, in declaration order. Null for chores that never
 * auto-start.
 */
export function fingerprintFor(key: string, task: TaskRow): string | null {
  const auto = CHORES.find((c) => c.key === key)?.auto;
  if (!auto) return null;
  return JSON.stringify(auto.fields.map((f) => (typeof f === "function" ? f(task) : task[f]) ?? null));
}

export function getChoreDefinitions(): ChoreDefinition[] {
  return CHORES.map(({ number, key, name, condition, prompt, supportsBulk, requiresSameRepo, repoPairs, auto }) => ({
    number,
    key,
    name,
    condition,
    prompt,
    supportsBulk: supportsBulk ?? false,
    requiresSameRepo: requiresSameRepo ?? false,
    repoPairs: repoPairs ?? null,
    auto: auto !== undefined,
  }));
}

/**
 * Pseudo-chore for ad-hoc prompts typed in the AI column. Not in CHORES, so it
 * never shows up in the chore list.
 */
export const CUSTOM_CHORE = { key: "custom", name: "Custom prompt", cwd: "task" } as const;

/**
 * Pseudo-chore for reviewing a colleague's PR from the Reviews page. Runs in
 * the repo's main checkout without a task: the skill reads the PR from git
 * objects, so several reviews can share that folder.
 */
export const REVIEW_CHORE = { key: "review-pr", name: "Code review", prompt: "/chore-code-review-pr", cwd: "main" } as const;

/** Look up a chore by key (not the pseudo-chores), with the cwd it should run in. */
export function getChoreDefinition(key: string) {
  const chore = CHORES.find((c) => c.key === key);
  return chore ? { ...chore, cwd: chore.cwd ?? "task" } : null;
}

/** Parent tasks (by jiraKey) of the rows that have one. */
async function buildParentMap(rows: TaskRow[]): Promise<Map<string, TaskRow>> {
  const keys = [...new Set(rows.map((r) => r.parentKey).filter((k): k is string => !!k))];
  if (keys.length === 0) return new Map();
  const parents = await db.select().from(tasks).where(inArray(tasks.jiraKey, keys));
  return new Map(parents.map((p) => [p.jiraKey as string, p]));
}

/** A chore a task is due for, with the rows it was matched on. */
interface ChoreMatch {
  chore: Chore;
  task: TaskRow;
  repo: RepoRow | null;
}

/**
 * Every chore each active task is due for, in the order to run them: tasks
 * closest to done first (tall strategy: finish one task before starting
 * another), then high priority first, then by chore number.
 */
export async function matchChores(opts: { taskId?: number } = {}): Promise<ChoreMatch[]> {
  const categories = (await getStatusCategories()).map((c) => ({ ...c, statuses: statusNamesOf(c) }));
  const inCategories = (names: string[], status: string) =>
    categories.some((c) => names.includes(c.name) && c.statuses.includes(status));
  const order = new Map(categories.flatMap((c) => c.statuses.map((s) => [s, c.displayOrder] as const)));

  const conditions = [await getNotCompletedCondition(), sql`COALESCE(${tasks.onIce}, 0) = 0`];
  if (opts.taskId !== undefined) conditions.push(eq(tasks.id, opts.taskId));
  const rows = await db.select().from(tasks).where(and(...conditions));
  const repoMap = await buildRepoMap(rows);
  const parentMap = await buildParentMap(rows);

  const matches: ChoreMatch[] = [];
  for (const task of rows) {
    const status = task.status.toLowerCase();
    const skips = parseChoreSkips(task.choreSkips);
    const repo = task.repositoryId ? (repoMap.get(task.repositoryId) ?? null) : null;
    const parent = task.parentKey ? (parentMap.get(task.parentKey) ?? null) : null;
    for (const chore of CHORES) {
      if (skips[chore.key]) continue;
      if (chore.categories && !inCategories(chore.categories, status)) continue;
      if (chore.excludeCategories && inCategories(chore.excludeCategories, status)) continue;
      if (chore.match(task, repo, parent)) matches.push({ chore, task, repo });
    }
  }

  const rank = (task: TaskRow) => order.get(task.status.toLowerCase()) ?? 999;
  return matches.sort(
    (a, b) =>
      rank(a.task) - rank(b.task) ||
      (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0) ||
      a.task.id - b.task.id ||
      a.chore.number - b.chore.number,
  );
}

/** The chore list the API serves: every match, its prompt filled for its task. */
export async function getChores(opts: { taskId?: number } = {}): Promise<ChoreEntry[]> {
  return (await matchChores(opts)).map(({ chore, task, repo }) => ({
    number: chore.number,
    key: chore.key,
    name: chore.name,
    prompt: resolvePrompt(chore.prompt, task),
    task: {
      id: task.id,
      title: task.title,
      jiraKey: task.jiraKey,
      sprint: task.sprint,
      prNumber: task.prNumber,
      headBranch: task.headBranch,
      baseBranch: task.baseBranch,
      status: task.status,
      highPriority: task.highPriority,
      repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
    },
  }));
}
