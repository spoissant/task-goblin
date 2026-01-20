// API Response types

// Check detail for individual CI checks
export interface CheckDetail {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  url: string | null;
}

// Unified Task - can be manual, Jira-only, PR-only, or merged
export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;

  // Jira fields (nullable - set when jiraKey present)
  jiraKey: string | null;
  type: string | null;
  assignee: string | null;
  priority: string | null;
  sprint: string | null;
  epicKey: string | null;
  lastComment: string | null;
  jiraSyncedAt: string | null;

  // GitHub/PR fields (nullable - set when prNumber present)
  prNumber: number | null;
  repositoryId: number | null;
  headBranch: string | null;
  baseBranch: string | null;
  prState: string | null;
  prAuthor: string | null;
  isDraft: number | null;
  checksStatus: string | null;
  checksDetails: string | null;
  reviewStatus: string | null;
  approvedReviewCount: number | null;
  prSyncedAt: string | null;
  onDeploymentBranches: string | null; // JSON array of deployment branches PR is on
  unresolvedCommentCount: number | null;
}

// Task detail with relations
export interface TaskDetail extends Task {
  todos: Todo[];
  blockedBy: BlockedBy[];
  repository: Repository | null;
  logs: Log[];
}

// Task with repository for curation view
export interface TaskWithRepository extends Task {
  repository: Repository | null;
}

// Task with next todo for dashboard
export interface TaskWithNextTodo extends Task {
  nextTodo: NextTodo | null;
}

export interface Todo {
  id: number;
  content: string;
  done: string | null;
  taskId: number | null;
  position: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoWithTask extends Todo {
  task: {
    jiraKey: string | null;
    title: string;
  } | null;
}

export interface NextTodo {
  id: number;
  content: string;
  position: number | null;
}

export interface Repository {
  id: number;
  owner: string;
  repo: string;
  enabled: number;
  badgeColor: string | null;
  deploymentBranches: string | null; // JSON array of branch names
}

export interface BlockedBy {
  id: number;
  blockedTaskId: number | null;
  blockerTaskId: number | null;
  blockerTodoId: number | null;
}

export interface Settings {
  [key: string]: string | null;
}

export interface LogTask {
  id: number;
  jiraKey: string | null;
  prNumber: number | null;
  title: string;
  repository: { owner: string; repo: string } | null;
}

export interface Log {
  id: number;
  taskId: number | null;
  content: string;
  createdAt: string;
  readAt: string | null;
  source: string;
  task?: LogTask | null;
}

export interface JiraConfig {
  jira_host: string | null;
  jira_email: string | null;
  jira_project: string | null;
  jira_jql: string | null;
  jira_sprint_field?: string | null;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export interface PaginatedResponse<T> extends ListResponse<T> {
  limit: number;
  offset: number;
}

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
}

export interface AutoMatchResult {
  matches: Array<{
    jiraTaskId: number;
    prTaskId: number;
    jiraKey: string;
  }>;
  total: number;
}

export interface SplitResult {
  jiraTask: Task;
  prTask: Task;
}

// Helper type guards
export function isJiraTask(task: Task): boolean {
  return task.jiraKey !== null;
}

export function isPrTask(task: Task): boolean {
  return task.prNumber !== null;
}

export function isMergedTask(task: Task): boolean {
  return task.jiraKey !== null && task.prNumber !== null;
}

export function isManualTask(task: Task): boolean {
  return task.jiraKey === null && task.prNumber === null;
}

export function isOrphanJiraTask(task: Task): boolean {
  return task.jiraKey !== null && task.prNumber === null;
}

export function isOrphanPrTask(task: Task): boolean {
  return task.prNumber !== null && task.jiraKey === null;
}

export function isLinkedTask(task: Task): boolean {
  return isManualTask(task) || isMergedTask(task);
}
