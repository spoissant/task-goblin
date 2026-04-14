import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { tasks, repositories } from "../../db/schema";
import { getNotCompletedCondition } from "./task-status";
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
  tier: 1 | 2 | 3;
  match: (task: TaskRow, repo: RepoRow | null) => boolean;
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
  prNumber: number | null;
  headBranch: string | null;
  baseBranch: string | null;
  status: string;
  repository: { owner: string; repo: string } | null;
}

const TIER_1_STATUSES = ["Code Review", "Code review", "Ready for Test", "QA", "Design QA", "Ready to Merge"];

// Lower value = closer to merge = sorted first
const STATUS_MERGE_ORDER: Record<string, number> = {
  "ready to merge": 0,
  "design qa": 1,
  "qa": 2,
  "ready for test": 3,
  "code review": 4,
};

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
    key: "pr-checks",
    name: "Failed PR Checks",
    condition: "checksStatus = failing",
    prompt: "/chore-pr-checks {{taskId}}",
    tier: 1,
    match: (t) => t.checksStatus === "failing",
  },
  {
    number: 2,
    key: "pr-comments",
    name: "Unresolved PR Comments",
    condition: "unresolvedCommentCount > 0",
    prompt: "/chore-pr-comments {{taskId}}",
    tier: 1,
    match: (t) => (t.unresolvedCommentCount ?? 0) > 0,
  },
  {
    number: 3,
    key: "draft-review",
    name: "Draft PR Pre-Review",
    condition: "isDraft = true",
    prompt: "/chore-draft-review {{taskId}}",
    tier: 1,
    match: (t) => t.isDraft === 1,
  },
  {
    number: 4,
    key: "review-request",
    name: "Request Code Reviews",
    condition: "isDraft = false AND prState = open AND approvedReviewCount < 2",
    prompt: "/chore-request-reviews {{taskId}}",
    tier: 1,
    match: (t) => t.isDraft === 0 && t.prState === "open" && (t.approvedReviewCount ?? 0) < 2,
  },
  {
    number: 5,
    key: "merge-conflicts",
    name: "Merge Conflicts",
    condition: "hasConflicts = true",
    prompt: "/chore-merge-conflicts {{taskId}}",
    tier: 1,
    match: (t) => t.hasConflicts === 1,
  },
  {
    number: 6,
    key: "deploy-staging",
    name: "Deploy to Staging",
    condition: "prState = open AND checksStatus = passing AND unresolvedCommentCount = 0 AND isDraft = false AND hasConflicts = false AND not on any deployment branch",
    prompt: "/chore-deploy-staging {{taskId}}",
    tier: 1,
    match: (t, repo) =>
      t.prState === "open" &&
      t.checksStatus === "passing" &&
      (t.unresolvedCommentCount ?? 0) === 0 &&
      t.isDraft === 0 &&
      (t.hasConflicts ?? 0) === 0 &&
      !isOnAnyDeploymentBranch(t, repo),
  },
  {
    number: 7,
    key: "dev-qa",
    name: "Dev QA",
    condition: "status = Code Review AND deployedOnBranches.length > 0",
    prompt: "/chore-dev-qa {{taskId}}",
    tier: 1,
    match: (t) =>
      (t.status === "Code Review" || t.status === "Code review") &&
      parseDeploymentBranches(t.deployedOnBranches).length > 0,
  },
  {
    number: 8,
    key: "continue-work",
    name: "Continue In Progress",
    condition: "status = In Progress",
    prompt: "/chore-continue-work {{taskId}}",
    tier: 2,
    match: (t) => t.status === "In Progress",
  },
  {
    number: 9,
    key: "start-task",
    name: "Start New Task",
    condition: "status IN (To Do, Backlog, Ready to refine)",
    prompt: "/chore-start-task {{taskId}}",
    tier: 3,
    match: (t) => ["To Do", "Backlog", "Ready to refine"].includes(t.status),
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

function sortTier1(list: TaskWithRepo[]): TaskWithRepo[] {
  return [...list].sort((a, b) => {
    const hpDiff = (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0);
    if (hpDiff !== 0) return hpDiff;
    const aOrder = STATUS_MERGE_ORDER[a.task.status.toLowerCase()] ?? 99;
    const bOrder = STATUS_MERGE_ORDER[b.task.status.toLowerCase()] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.task.id - b.task.id;
  });
}

function sortTier23(list: TaskWithRepo[]): TaskWithRepo[] {
  return [...list].sort((a, b) => {
    const hpDiff = (b.task.highPriority ?? 0) - (a.task.highPriority ?? 0);
    if (hpDiff !== 0) return hpDiff;
    return a.task.id - b.task.id;
  });
}

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

  const neededTiers = new Set(filteredChores.map((c) => c.tier));

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

  async function fetchByStatuses(statuses: string[]): Promise<TaskRow[]> {
    const conditions = [
      notCompleted,
      sql`${tasks.status} IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`,
    ];
    if (repoId !== null) {
      conditions.push(eq(tasks.repositoryId, repoId));
    }
    return db.select().from(tasks).where(and(...conditions));
  }

  const [tier1Rows, tier2Rows, tier3Rows] = await Promise.all([
    neededTiers.has(1) ? fetchByStatuses(TIER_1_STATUSES) : Promise.resolve([]),
    neededTiers.has(2) ? fetchByStatuses(["In Progress"]) : Promise.resolve([]),
    neededTiers.has(3) ? fetchByStatuses(["To Do", "Backlog", "Ready to refine"]) : Promise.resolve([]),
  ]);

  const allTasks = [...tier1Rows, ...tier2Rows, ...tier3Rows];
  const repoMap = await buildRepoMap(allTasks);

  function attachRepo(rows: TaskRow[]): TaskWithRepo[] {
    return rows.map((task) => ({
      task,
      repo: task.repositoryId ? (repoMap.get(task.repositoryId) ?? null) : null,
    }));
  }

  const tier1 = sortTier1(attachRepo(tier1Rows));
  const tier2 = sortTier23(attachRepo(tier2Rows));
  const tier3 = sortTier23(attachRepo(tier3Rows));

  const entries: ChoreEntry[] = [];

  for (const chore of filteredChores) {
    const candidates = chore.tier === 1 ? tier1 : chore.tier === 2 ? tier2 : tier3;

    for (const { task, repo } of candidates) {
      const skips = parseChoreSkips(task.choreSkips);
      if (skips[chore.key]) continue;
      if (!chore.match(task, repo)) continue;

      entries.push({
        number: chore.number,
        key: chore.key,
        name: chore.name,
        prompt: resolvePrompt(chore.prompt, task),
        task: {
          id: task.id,
          title: task.title,
          jiraKey: task.jiraKey ?? null,
          prNumber: task.prNumber ?? null,
          headBranch: task.headBranch ?? null,
          baseBranch: task.baseBranch ?? null,
          status: task.status,
          repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
        },
      });
    }
  }

  return entries;
}
