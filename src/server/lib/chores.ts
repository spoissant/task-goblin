import { and, eq, isNull, sql } from "drizzle-orm";
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
    key: "fix-pr-checks",
    name: "Fix PR checks",
    condition: "checksStatus = failing",
    prompt: "/chore-fix-pr-checks {{taskId}}",
    categories: null,
    match: (t) => t.checksStatus === "failing",
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
    key: "code-review-pr",
    name: "Code review my PR",
    condition: "status category = Code Review AND isDraft = true",
    prompt: "/chore-code-review-pr {{taskId}}",
    categories: ["Code Review"],
    match: (t) => t.isDraft === 1,
  },
  {
    number: 5,
    key: "request-reviews",
    name: "Request Code Reviews",
    condition: "isDraft = false AND prState = open AND approvedReviewCount < 2",
    prompt: "/chore-request-reviews {{taskId}}",
    categories: null,
    match: (t) => t.isDraft === 0 && t.prState === "open" && (t.approvedReviewCount ?? 0) < 2,
  },
  {
    number: 6,
    key: "fix-merge-conflicts",
    name: "Fix Merge Conflicts",
    condition: "hasConflicts = true",
    prompt: "/chore-fix-merge-conflicts {{taskId}}",
    categories: null,
    match: (t) => t.hasConflicts === 1,
  },
  {
    number: 7,
    key: "deploy-test-env",
    name: "Deploy to Test Env",
    condition: "prState = open AND checksStatus = passing AND unresolvedCommentCount = 0 AND isDraft = false AND hasConflicts = false AND not on any deployment branch",
    prompt: "/chore-deploy-to-test-env {{taskId}}",
    categories: null,
    match: (t, repo) =>
      t.prState === "open" &&
      t.checksStatus === "passing" &&
      (t.unresolvedCommentCount ?? 0) === 0 &&
      t.isDraft === 0 &&
      (t.hasConflicts ?? 0) === 0 &&
      !isOnAnyDeploymentBranch(t, repo),
  },
  {
    number: 8,
    key: "dev-qa-video",
    name: "Requires Dev QA Video",
    condition: "status category = Code Review AND deployedOnBranches.length > 0",
    prompt: "/chore-dev-qa-video {{taskId}}",
    categories: ["Code Review"],
    match: (t) => parseDeploymentBranches(t.deployedOnBranches).length > 0,
  },
  {
    number: 9,
    key: "continue-work",
    name: "Continue In Progress",
    condition: "status category = In Progress",
    prompt: "/chore-continue-work {{taskId}}",
    categories: ["In Progress"],
    match: () => true,
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
  return CHORES.map(({ number, name, condition, prompt }) => ({
    number,
    name,
    condition,
    prompt,
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
}

export async function getChores(opts: GetChoresOptions = {}): Promise<ChoreEntry[]> {
  const { minChore, maxChore, repository } = opts;

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

  const notCompleted = getNotCompletedCondition();

  async function fetchAllActive(): Promise<TaskRow[]> {
    const conditions = [notCompleted];
    if (repoId !== null) conditions.push(eq(tasks.repositoryId, repoId));
    return db.select().from(tasks).where(and(...conditions));
  }

  async function fetchByStatuses(statuses: string[]): Promise<TaskRow[]> {
    if (statuses.length === 0) return [];
    const conditions = [
      notCompleted,
      sql`${tasks.status} IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`,
    ];
    if (repoId !== null) conditions.push(eq(tasks.repositoryId, repoId));
    return db.select().from(tasks).where(and(...conditions));
  }

  // Collect unique category keys needed by the filtered chore set
  const neededKeys = new Set<string | null>();
  for (const chore of filteredChores) {
    neededKeys.add(chore.categories ? JSON.stringify(chore.categories) : null);
  }

  // Batch-fetch all unique category sets in parallel
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

  // Attach repos and sort each batch: highPriority DESC → displayOrder DESC (closer to merge first) → id ASC
  const candidateCache = new Map<string | null, TaskWithRepo[]>();
  for (const [key, rows] of batchRows) {
    const withRepo: TaskWithRepo[] = rows.map((task) => ({
      task,
      repo: task.repositoryId ? (repoMap.get(task.repositoryId) ?? null) : null,
    }));
    withRepo.sort((a, b) => {
      const hpDiff = (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0);
      if (hpDiff !== 0) return hpDiff;
      const aOrder = statusToDisplayOrder.get(a.task.status.toLowerCase()) ?? -1;
      const bOrder = statusToDisplayOrder.get(b.task.status.toLowerCase()) ?? -1;
      if (aOrder !== bOrder) return bOrder - aOrder;
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
          repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
        },
      });
    }
  }

  // Fetch pending custom chore todos, joined to their task
  const customTodoRows = await db
    .select({
      todo: todos,
      task: tasks,
    })
    .from(todos)
    .innerJoin(tasks, eq(todos.taskId, tasks.id))
    .where(
      and(
        eq(todos.isCustomChore, 1),
        isNull(todos.done),
        ...(repoId !== null ? [eq(tasks.repositoryId, repoId)] : [])
      )
    );

  // Build repoMap for custom chore tasks
  const customTaskRows = customTodoRows.map((r) => r.task);
  const customRepoMap = await buildRepoMap(customTaskRows);

  const customEntries: ChoreEntry[] = customTodoRows
    .filter((r) => {
      if (minChore !== undefined && (r.todo.choreRank ?? 0) < minChore) return false;
      if (maxChore !== undefined && (r.todo.choreRank ?? 0) > maxChore) return false;
      const skips = parseChoreSkips(r.task.choreSkips);
      if (skips[`custom-chore-${r.todo.id}`]) return false;
      return true;
    })
    .map((r) => {
      const repo = r.task.repositoryId ? (customRepoMap.get(r.task.repositoryId) ?? null) : null;
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
          repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
        },
      };
    })
    // Sort custom chores by (position ASC, id ASC) within same rank
    .sort((a, b) => {
      const aRow = customTodoRows.find((r) => `custom-chore-${r.todo.id}` === a.key)!;
      const bRow = customTodoRows.find((r) => `custom-chore-${r.todo.id}` === b.key)!;
      const posDiff = (aRow.todo.position ?? 999999) - (bRow.todo.position ?? 999999);
      if (posDiff !== 0) return posDiff;
      return aRow.todo.id - bRow.todo.id;
    });

  // Merge and sort: number ASC, then custom before hardcoded (isCustom DESC), existing tiebreakers preserved
  const allEntries = [...hardcodedEntries, ...customEntries];
  allEntries.sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    // Within same number: custom runs first
    const aCustom = a.isCustom ? 1 : 0;
    const bCustom = b.isCustom ? 1 : 0;
    return bCustom - aCustom;
  });

  return allEntries;
}
