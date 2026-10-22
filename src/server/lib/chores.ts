import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { getNotCompletedCondition, getStatusCategories } from "./task-status";
import { buildRepoMap } from "./queries";
import { parseDeploymentBranches } from "./validation";
import { checksFailedAt } from "./checks";
import type { RepoPair } from "@/shared/chore-pairs";
import { resolvePrompt, type ChoreDefinition, type ChoreEntry } from "@/shared/chores";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;
/** A task column, or a value computed from the task row. */
type TriggerField = keyof TaskRow | ((task: TaskRow) => unknown);

interface Chore {
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
   * to pass a default env).
   */
  auto?: { fields: TriggerField[]; prompt?: string };
}

export function parseChoreSkips(value: string | null): Record<string, boolean> {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isOnAnyDeploymentBranch(task: TaskRow, repo: RepoRow | null): boolean {
  if (!repo) return false;
  const repoBranches = parseDeploymentBranches(repo.deploymentBranches);
  if (repoBranches.length === 0) return false;
  const taskBranches = parseDeploymentBranches(task.onDeploymentBranches);
  return repoBranches.some((b) => taskBranches.includes(b));
}

// A hivetests sub-task's hermetic specs run against its alumni_connect parent's
// code, so its AI QA waits until the parent has a PR.
function awaitsParentPr(repo: RepoRow | null, parent: TaskRow | null): boolean {
  return repo?.repo === "hivetests" && parent !== null && parent.prNumber === null;
}

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
      parseDeploymentBranches(repo?.deploymentBranches ?? null).length > 0 &&
      t.prState === "open" &&
      t.checksStatus === "passing" &&
      (t.unresolvedCommentCount ?? 0) === 0 &&
      t.isDraft === 0 &&
      (t.hasConflicts ?? 0) === 0 &&
      !isOnAnyDeploymentBranch(t, repo),
    // Auto-starts only deploy to staging (the scheduler checks the repo has it).
    auto: { fields: ["headSha", "onDeploymentBranches"], prompt: "/chore-deploy-to-test-env {{taskId}} staging" },
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
];

/** Whether the chore scheduler may start this chore on its own. */
export function isAutoChore(key: string): boolean {
  return CHORES.some((c) => c.key === key && c.auto !== undefined);
}

/**
 * One string per distinct trigger state of a chore on a task: the values of
 * the chore's `auto.fields`, in declaration order. Null for chores that never
 * auto-start.
 */
export function fingerprintFor(key: string, task: TaskRow): string | null {
  const chore = CHORES.find((c) => c.key === key);
  if (!chore?.auto) return null;
  return JSON.stringify(chore.auto.fields.map((f) => (typeof f === "function" ? f(task) : task[f]) ?? null));
}

/** Whether the chore runs on several tasks in one session. */
export function isBulkChore(key: string): boolean {
  return CHORES.some((c) => c.key === key && c.supportsBulk);
}

/**
 * The prompt an auto-start uses: the chore's `auto.prompt` when set, else its
 * usual one. `taskIds` lists every task of a bulk run, the first being `task`.
 */
export function autoPromptFor(key: string, task: Pick<TaskRow, "id" | "jiraKey">, taskIds?: number[]): string | null {
  const chore = CHORES.find((c) => c.key === key);
  if (!chore?.auto) return null;
  return resolvePrompt(chore.auto.prompt ?? chore.prompt, task, taskIds);
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

/** Look up a chore by key, with the cwd it should run in. */
/**
 * Pseudo-chore for ad-hoc prompts typed in the AI column. Not in CHORES, so it
 * never shows up in the chore list.
 */
export const CUSTOM_CHORE = { key: "custom", name: "Custom prompt", prompt: "", cwd: "task" } as const;

/**
 * Pseudo-chore for reviewing a colleague's PR from the Reviews page. Runs in
 * the repo's main checkout without a task: the skill reads the PR from git
 * objects, so several reviews can share that folder.
 */
export const REVIEW_CHORE = { key: "review-pr", name: "Code review", prompt: "/chore-code-review-pr", cwd: "main" } as const;

export function getChoreDefinition(key: string) {
  if (key === CUSTOM_CHORE.key) return CUSTOM_CHORE;
  if (key === REVIEW_CHORE.key) return REVIEW_CHORE;
  const chore = CHORES.find((c) => c.key === key);
  if (!chore) return null;
  return {
    key: chore.key,
    name: chore.name,
    prompt: chore.prompt,
    cwd: chore.cwd ?? "task",
    requiresSameRepo: chore.requiresSameRepo ?? false,
  } as const;
}

type TaskWithRepo = { task: TaskRow; repo: RepoRow | null };

/** Parent tasks (by jiraKey) of the rows that have one. */
async function buildParentMap(rows: TaskRow[]): Promise<Map<string, TaskRow>> {
  const keys = [...new Set(rows.map((r) => r.parentKey).filter((k): k is string => !!k))];
  if (keys.length === 0) return new Map();
  const parents = await db.select().from(tasks).where(inArray(tasks.jiraKey, keys));
  return new Map(parents.map((p) => [p.jiraKey as string, p]));
}

export async function getChores(opts: { taskId?: number } = {}): Promise<ChoreEntry[]> {
  const { taskId } = opts;

  // Load status categories once — used for resolving category names → status strings and for sorting
  const allCategories = await getStatusCategories();

  const categoryToStatuses = new Map<string, string[]>();
  const statusToDisplayOrder = new Map<string, number>();
  for (const cat of allCategories) {
    const statuses = [cat.name, ...cat.jiraMappings];
    categoryToStatuses.set(cat.name, statuses);
    for (const s of statuses) {
      statusToDisplayOrder.set(s.toLowerCase(), cat.displayOrder);
    }
  }

  const notCompleted = await getNotCompletedCondition();
  const notOnIce = sql`COALESCE(${tasks.onIce}, 0) = 0`;

  async function fetchAllActive(): Promise<TaskRow[]> {
    const conditions = [notCompleted, notOnIce];
    if (taskId !== undefined) conditions.push(eq(tasks.id, taskId));
    return db.select().from(tasks).where(and(...conditions));
  }

  async function fetchByStatuses(statuses: string[]): Promise<TaskRow[]> {
    if (statuses.length === 0) return [];
    const lowered = statuses.map((s) => s.toLowerCase());
    const conditions = [
      notCompleted,
      notOnIce,
      sql`LOWER(${tasks.status}) IN (${sql.join(lowered.map((s) => sql`${s}`), sql`, `)})`,
    ];
    if (taskId !== undefined) conditions.push(eq(tasks.id, taskId));
    return db.select().from(tasks).where(and(...conditions));
  }

  // Collect unique category keys needed by the chores
  const neededKeys = new Set<string | null>();
  for (const chore of CHORES) {
    neededKeys.add(chore.categories ? JSON.stringify(chore.categories) : null);
  }

  // Fetch hardcoded chore candidates in parallel
  const batchRows = new Map<string | null, TaskRow[]>();

  await Promise.all(
    [...neededKeys].map(async (key) => {
      let rows: TaskRow[];
      if (key === null) {
        rows = await fetchAllActive();
      } else {
        const categoryNames: string[] = JSON.parse(key);
        const statuses = categoryNames.flatMap((name) => categoryToStatuses.get(name) ?? []);
        rows = await fetchByStatuses(statuses);
      }
      batchRows.set(key, rows);
    })
  );

  // Build a single repoMap across all fetched tasks
  const allRows = [...batchRows.values()].flat();
  const repoMap = await buildRepoMap(allRows);
  const parentMap = await buildParentMap(allRows);

  // Attach repos and sort each batch: displayOrder ASC (closer to done first) → highPriority DESC → id ASC
  const candidateCache = new Map<string | null, TaskWithRepo[]>();
  for (const [key, rows] of batchRows) {
    const withRepo: TaskWithRepo[] = rows.map((task) => ({
      task,
      repo: task.repositoryId ? (repoMap.get(task.repositoryId) ?? null) : null,
    }));
    withRepo.sort((a, b) => {
      const aOrder = statusToDisplayOrder.get(a.task.status.toLowerCase()) ?? 999;
      const bOrder = statusToDisplayOrder.get(b.task.status.toLowerCase()) ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const hpDiff = (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0);
      if (hpDiff !== 0) return hpDiff;
      return a.task.id - b.task.id;
    });
    candidateCache.set(key, withRepo);
  }

  const entries: ChoreEntry[] = [];

  for (const chore of CHORES) {
    const cacheKey = chore.categories ? JSON.stringify(chore.categories) : null;
    const candidates = candidateCache.get(cacheKey) ?? [];

    const excludedStatuses = new Set<string>(
      (chore.excludeCategories ?? []).flatMap(
        (name) => categoryToStatuses.get(name)?.map((s) => s.toLowerCase()) ?? []
      )
    );

    for (const { task, repo } of candidates) {
      const skips = parseChoreSkips(task.choreSkips);
      if (skips[chore.key]) continue;
      if (excludedStatuses.has(task.status.toLowerCase())) continue;
      if (!chore.match(task, repo, task.parentKey ? (parentMap.get(task.parentKey) ?? null) : null)) continue;

      entries.push({
        number: chore.number,
        key: chore.key,
        name: chore.name,
        prompt: resolvePrompt(chore.prompt, task),
        task: {
          id: task.id,
          title: task.title,
          jiraKey: task.jiraKey ?? null,
          sprint: task.sprint ?? null,
          prNumber: task.prNumber ?? null,
          headBranch: task.headBranch ?? null,
          baseBranch: task.baseBranch ?? null,
          status: task.status,
          highPriority: task.highPriority ?? null,
          repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
        },
      });
    }
  }

  // Sort: task priority first (tall strategy — finish one task before starting another),
  // then chore number ASC within the same task.
  entries.sort((a, b) => {
    const aOrder = statusToDisplayOrder.get(a.task.status.toLowerCase()) ?? 999;
    const bOrder = statusToDisplayOrder.get(b.task.status.toLowerCase()) ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const hpDiff = (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0);
    if (hpDiff !== 0) return hpDiff;
    if (a.task.id !== b.task.id) return a.task.id - b.task.id;
    return a.number - b.number;
  });

  return entries;
}
