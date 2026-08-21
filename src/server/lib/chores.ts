import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories, todos } from "../../db/schema";
import { getNotCompletedCondition, getStatusCategories } from "./task-status";
import { buildRepoMap } from "./queries";
import { parseDeploymentBranches } from "./validation";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repositories.$inferSelect;

interface ChoreDefinition {
  number: number;
  key: string;
  name: string;
  condition: string;
  prompt: string; // template: {{taskId}}, {{jiraKey}}
  categories: string[] | null; // null = all active tasks; array = category names from DB
  excludeCategories?: string[]; // category names whose tasks must never match this chore
  match: (task: TaskRow, repo: RepoRow | null, pendingTodos: number) => boolean;
  supportsBulk?: boolean; // can be invoked with multiple task IDs at once
}

export interface ChoreEntry {
  number: number;
  key: string;
  name: string;
  prompt: string;
  task: ChoreTask;
}

export interface ChoreTask {
  id: number;
  title: string;
  jiraKey: string | null;
  sprint: string | null;
  prNumber: number | null;
  headBranch: string | null;
  baseBranch: string | null;
  status: string;
  highPriority: number | null;
  repository: { owner: string; repo: string } | null;
}

function parseChoreSkips(value: string | null): Record<string, boolean> {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

const RESERVATION_TTL_MS = 30 * 60 * 1000;

function isTaskReserved(workingOn: string | null): boolean {
  if (!workingOn) return false;
  try {
    const parsed = JSON.parse(workingOn) as { at?: string };
    if (!parsed.at) return false;
    return Date.now() - Date.parse(parsed.at) < RESERVATION_TTL_MS;
  } catch {
    return false;
  }
}

function isOnAnyDeploymentBranch(task: TaskRow, repo: RepoRow | null): boolean {
  if (!repo) return false;
  const repoBranches = parseDeploymentBranches(repo.deploymentBranches);
  if (repoBranches.length === 0) return false;
  const taskBranches = parseDeploymentBranches(task.onDeploymentBranches);
  return repoBranches.some((b) => taskBranches.includes(b));
}

const CHORES: ChoreDefinition[] = [
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
    number: 2,
    key: "assign-jira-ticket",
    name: "Assign Jira Ticket",
    condition: "prNumber != null AND jiraKey = null",
    prompt: "/chore-assign-jira-ticket {{taskId}}",
    categories: null,
    match: (t) => t.prNumber !== null && !t.jiraKey,
  },
  {
    number: 3,
    key: "fix-merge-conflicts",
    name: "Fix Merge Conflicts",
    condition: "hasConflicts = true",
    prompt: "/chore-fix-merge-conflicts {{taskId}}",
    categories: null,
    match: (t) => t.hasConflicts === 1,
  },
  {
    number: 4,
    key: "address-pr-comments",
    name: "Address Comments & Todos",
    condition: "unresolvedCommentCount > 0 OR pending todos > 0",
    prompt: "/chore-address-pr-comments {{taskId}}",
    categories: null,
    match: (t, _repo, pendingTodos) =>
      (t.unresolvedCommentCount ?? 0) > 0 || pendingTodos > 0,
  },
  {
    number: 5,
    key: "fix-pr-checks",
    name: "Fix PR checks",
    condition: "checksStatus = failing",
    prompt: "/chore-fix-pr-checks {{taskId}}",
    categories: null,
    match: (t) => t.checksStatus === "failing",
  },
  {
    number: 6,
    key: "continue-work",
    name: "Continue In Progress",
    condition: "status category = In Progress AND checksStatus != pending",
    prompt: "/chore-continue-work {{taskId}}",
    categories: ["In Progress"],
    match: (t) => t.checksStatus !== "pending",
  },
  {
    number: 7,
    key: "code-review-pr",
    name: "Code review my PR",
    condition: "status category = Code Review AND isDraft = true",
    prompt: "/chore-code-review-pr {{taskId}}",
    categories: ["Code Review"],
    match: (t) => t.isDraft === 1,
  },
  {
    number: 8,
    key: "request-reviews",
    name: "Request Code Reviews",
    condition: "isDraft = false AND prState = open AND approvedReviewCount < repo.requiredReviews",
    prompt: "/chore-request-reviews {{taskId}}",
    categories: null,
    supportsBulk: true,
    match: (t, repo) =>
      t.isDraft === 0 &&
      t.prState === "open" &&
      (t.approvedReviewCount ?? 0) < (repo?.requiredReviews ?? 2),
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
    match: (t, repo) =>
      parseDeploymentBranches(repo?.deploymentBranches ?? null).length > 0 &&
      t.prState === "open" &&
      t.checksStatus === "passing" &&
      (t.unresolvedCommentCount ?? 0) === 0 &&
      t.isDraft === 0 &&
      (t.hasConflicts ?? 0) === 0 &&
      !isOnAnyDeploymentBranch(t, repo),
  },
  {
    number: 10,
    key: "dev-qa-video",
    name: "Requires Dev QA Video",
    condition: "status category = Code Review AND deployedOnBranches.length > 0",
    prompt: "/chore-dev-qa-video {{taskId}}",
    categories: ["Code Review"],
    match: (t) => parseDeploymentBranches(t.deployedOnBranches).length > 0,
  },
];

export function getChoreDefinitions() {
  return CHORES.map(({ number, key, name, condition, prompt, supportsBulk }) => ({
    number,
    key,
    name,
    condition,
    prompt,
    supportsBulk: supportsBulk ?? false,
  }));
}

function resolvePrompt(template: string, task: TaskRow): string {
  return template
    .replace("{{taskId}}", String(task.id))
    .replace("{{jiraKey}}", task.jiraKey ?? "");
}

type TaskWithRepo = { task: TaskRow; repo: RepoRow | null };

export interface GetChoresOptions {
  minChore?: number;
  maxChore?: number;
  repository?: string; // "owner/repo"
  sprintView?: boolean;
  taskId?: number;
}

export async function getChores(opts: GetChoresOptions = {}): Promise<ChoreEntry[]> {
  const { minChore, maxChore, repository, sprintView, taskId } = opts;

  const filteredChores = CHORES.filter((c) => {
    if (minChore !== undefined && c.number < minChore) return false;
    if (maxChore !== undefined && c.number > maxChore) return false;
    return true;
  });

  if (filteredChores.length === 0) return [];

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

  // Optional repo filter — resolve owner/repo to ID
  let repoId: number | null = null;
  if (repository) {
    const [owner, repo] = repository.split("/");
    const found = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.owner, owner), eq(repositories.repo, repo)))
      .limit(1);
    if (found.length === 0) return [];
    repoId = found[0].id;
  }

  const notCompleted = await getNotCompletedCondition();
  const notOnIce = sql`COALESCE(${tasks.onIce}, 0) = 0`;

  async function fetchAllActive(): Promise<TaskRow[]> {
    const conditions = [notCompleted, notOnIce];
    if (repoId !== null) conditions.push(eq(tasks.repositoryId, repoId));
    if (sprintView) conditions.push(isNotNull(tasks.sprint));
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
    if (repoId !== null) conditions.push(eq(tasks.repositoryId, repoId));
    if (sprintView) conditions.push(isNotNull(tasks.sprint));
    if (taskId !== undefined) conditions.push(eq(tasks.id, taskId));
    return db.select().from(tasks).where(and(...conditions));
  }

  // Collect unique category keys needed by the filtered chore set
  const neededKeys = new Set<string | null>();
  for (const chore of filteredChores) {
    neededKeys.add(chore.categories ? JSON.stringify(chore.categories) : null);
  }

  // Fetch hardcoded chore candidates and pending-todo counts in parallel
  const batchRows = new Map<string | null, TaskRow[]>();

  const [pendingTodoRows] = await Promise.all([
    db
      .select({ taskId: todos.taskId, count: sql<number>`COUNT(*)` })
      .from(todos)
      .where(isNull(todos.done))
      .groupBy(todos.taskId),
    Promise.all(
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
    ),
  ]);

  // Pending todos count as unresolved feedback for chore 4 (address-pr-comments)
  const pendingTodoCounts = new Map<number, number>();
  for (const row of pendingTodoRows) {
    if (row.taskId !== null) pendingTodoCounts.set(row.taskId, row.count);
  }

  // Build a single repoMap across all fetched tasks
  const allRows = [...batchRows.values()].flat();
  const repoMap = await buildRepoMap(allRows);

  // Attach repos and sort each batch: displayOrder ASC (closer to done first) → highPriority DESC → id ASC
  const candidateCache = new Map<string | null, TaskWithRepo[]>();
  for (const [key, rows] of batchRows) {
    const withRepo: TaskWithRepo[] = rows
      .filter((task) => !isTaskReserved(task.workingOn ?? null))
      .map((task) => ({
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

  for (const chore of filteredChores) {
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
      if (!chore.match(task, repo, pendingTodoCounts.get(task.id) ?? 0)) continue;

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
