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
  match: (task: TaskRow, repo: RepoRow | null) => boolean;
  supportsBulk?: boolean; // can be invoked with multiple task IDs at once
}

export interface ChoreEntry {
  number: number;
  key: string;
  name: string;
  prompt: string;
  task: ChoreTask;
  isCustom?: boolean;
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
    key: "assign-jira-ticket",
    name: "Assign Jira Ticket",
    condition: "prNumber != null AND jiraKey = null",
    prompt: "/chore-assign-jira-ticket {{taskId}}",
    categories: null,
    match: (t) => t.prNumber !== null && !t.jiraKey,
  },
  {
    number: 2,
    key: "continue-work",
    name: "Continue In Progress",
    condition: "status category = In Progress",
    prompt: "/chore-continue-work {{taskId}}",
    categories: ["In Progress"],
    match: () => true,
  },
  {
    number: 3,
    key: "address-pr-comments",
    name: "Address PR Comments",
    condition: "unresolvedCommentCount > 0",
    prompt: "/chore-address-pr-comments {{taskId}}",
    categories: null,
    match: (t) => (t.unresolvedCommentCount ?? 0) > 0,
  },
  {
    number: 4,
    key: "fix-pr-checks",
    name: "Fix PR checks",
    condition: "checksStatus = failing",
    prompt: "/chore-fix-pr-checks {{taskId}}",
    categories: null,
    match: (t) => t.checksStatus === "failing",
  },
  {
    number: 5,
    key: "code-review-pr",
    name: "Code review my PR",
    condition: "status category = Code Review AND isDraft = true",
    prompt: "/chore-code-review-pr {{taskId}}",
    categories: ["Code Review"],
    match: (t) => t.isDraft === 1,
  },
  {
    number: 6,
    key: "request-reviews",
    name: "Request Code Reviews",
    condition: "isDraft = false AND prState = open AND approvedReviewCount < 2",
    prompt: "/chore-request-reviews {{taskId}}",
    categories: null,
    supportsBulk: true,
    match: (t) => t.isDraft === 0 && t.prState === "open" && (t.approvedReviewCount ?? 0) < 2,
  },
  {
    number: 7,
    key: "fix-merge-conflicts",
    name: "Fix Merge Conflicts",
    condition: "hasConflicts = true",
    prompt: "/chore-fix-merge-conflicts {{taskId}}",
    categories: null,
    match: (t) => t.hasConflicts === 1,
  },
  {
    number: 8,
    key: "deploy-test-env",
    name: "Deploy to Test Env",
    condition: "repo has deployment branches AND prState = open AND checksStatus = passing AND unresolvedCommentCount = 0 AND isDraft = false AND hasConflicts = false AND not on any deployment branch",
    prompt: "/chore-deploy-to-test-env {{taskId}}",
    categories: null,
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
    number: 9,
    key: "dev-qa-video",
    name: "Requires Dev QA Video",
    condition: "status category = Code Review AND deployedOnBranches.length > 0",
    prompt: "/chore-dev-qa-video {{taskId}}",
    categories: ["Code Review"],
    match: (t) => parseDeploymentBranches(t.deployedOnBranches).length > 0,
  },
  {
    number: 10,
    key: "start-task",
    name: "Start New Task",
    condition: "status category = Backlog",
    prompt: "/chore-start-task {{taskId}}",
    categories: ["Backlog"],
    match: () => true,
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

  // Fetch hardcoded chore candidates and custom chore todos in parallel
  const batchRows = new Map<string | null, TaskRow[]>();

  const [customTodoRows] = await Promise.all([
    db
      .select({ todo: todos, task: tasks })
      .from(todos)
      .innerJoin(tasks, eq(todos.taskId, tasks.id))
      .where(
        and(
          eq(todos.isCustomChore, 1),
          isNull(todos.done),
          notOnIce,
          ...(repoId !== null ? [eq(tasks.repositoryId, repoId)] : []),
          ...(sprintView ? [isNotNull(tasks.sprint)] : []),
          ...(taskId !== undefined ? [eq(tasks.id, taskId)] : [])
        )
      ),
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

  // Build a single repoMap across all fetched tasks
  const allRows = [...batchRows.values()].flat();
  const customTaskRows = customTodoRows.map((r) => r.task);
  const repoMap = await buildRepoMap([...allRows, ...customTaskRows]);

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

  const hardcodedEntries: ChoreEntry[] = [];

  for (const chore of filteredChores) {
    const cacheKey = chore.categories ? JSON.stringify(chore.categories) : null;
    const candidates = candidateCache.get(cacheKey) ?? [];

    for (const { task, repo } of candidates) {
      const skips = parseChoreSkips(task.choreSkips);
      if (skips[chore.key]) continue;
      if (!chore.match(task, repo)) continue;

      hardcodedEntries.push({
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

  const todoById = new Map(customTodoRows.map((r) => [r.todo.id, r.todo]));

  const customEntries: ChoreEntry[] = customTodoRows
    .filter((r) => {
      if (minChore !== undefined && (r.todo.choreRank ?? 0) < minChore) return false;
      if (maxChore !== undefined && (r.todo.choreRank ?? 0) > maxChore) return false;
      if (isTaskReserved(r.task.workingOn ?? null)) return false;
      const skips = parseChoreSkips(r.task.choreSkips);
      if (skips[`custom-chore-${r.todo.id}`]) return false;
      return true;
    })
    .map((r) => {
      const repo = r.task.repositoryId ? (repoMap.get(r.task.repositoryId) ?? null) : null;
      return {
        number: r.todo.choreRank ?? 0,
        key: `custom-chore-${r.todo.id}`,
        name: r.todo.content,
        prompt: r.todo.chorePrompt ?? "",
        isCustom: true,
        task: {
          id: r.task.id,
          title: r.task.title,
          jiraKey: r.task.jiraKey ?? null,
          sprint: r.task.sprint ?? null,
          prNumber: r.task.prNumber ?? null,
          headBranch: r.task.headBranch ?? null,
          baseBranch: r.task.baseBranch ?? null,
          status: r.task.status,
          highPriority: r.task.highPriority ?? null,
          repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
        },
      };
    })
    // Sort custom chores by (position ASC, id ASC) within same rank
    .sort((a, b) => {
      const aId = parseInt(a.key.replace("custom-chore-", ""), 10);
      const bId = parseInt(b.key.replace("custom-chore-", ""), 10);
      const aRow = todoById.get(aId)!;
      const bRow = todoById.get(bId)!;
      const posDiff = (aRow.position ?? 999999) - (bRow.position ?? 999999);
      if (posDiff !== 0) return posDiff;
      return aId - bId;
    });

  // Merge and sort: task priority first (tall strategy — finish one task before starting another),
  // then chore number ASC within the same task, then custom before hardcoded.
  const allEntries = [...hardcodedEntries, ...customEntries];
  allEntries.sort((a, b) => {
    const aOrder = statusToDisplayOrder.get(a.task.status.toLowerCase()) ?? 999;
    const bOrder = statusToDisplayOrder.get(b.task.status.toLowerCase()) ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const hpDiff = (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0);
    if (hpDiff !== 0) return hpDiff;
    if (a.task.id !== b.task.id) return a.task.id - b.task.id;
    if (a.number !== b.number) return a.number - b.number;
    const aCustom = a.isCustom ? 1 : 0;
    const bCustom = b.isCustom ? 1 : 0;
    return bCustom - aCustom;
  });

  return allEntries;
}
