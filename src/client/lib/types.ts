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
  approvedReviewCount: number | null;
  prSyncedAt: string | null;
  onDeploymentBranches: string | null; // JSON array of deployment branches PR is on
  unresolvedCommentCount: number | null;

  // User-editable markdown fields
  notes: string | null;
  instructions: string | null;
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

// Task with pending todos for dashboard
export interface TaskWithTodos extends Task {
  pendingTodos: NextTodo[];
  unreadLogCount: number;
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
  localPath: string | null; // Local filesystem path for git operations
}

// Deploy types
export interface DeployResult {
  status: "success";
  targetBranch: string;
  sourceBranch: string;
  commitSha: string;
}

export interface DeployConflictError {
  code: "MERGE_CONFLICT";
  message: string;
  details: {
    conflictedFiles: string[];
  };
}

export interface BulkDeployTaskResult {
  taskId: number;
  status: "success" | "conflict" | "skipped";
  commitSha?: string;
  conflictedFiles?: string[];
  reason?: string;
}

export interface BulkDeployResult {
  results: BulkDeployTaskResult[];
  summary: {
    success: number;
    conflict: number;
    skipped: number;
  };
}

// Sync branch types (merge main into feature branch)
export interface SyncBranchResult {
  status: "success";
  taskBranch: string;
  mainBranch: string;
  commitSha: string;
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

// New Status Settings types
export interface StatusCategory {
  id: number;
  name: string;
  color: string;
  done: boolean;
  displayOrder: number;
  jiraMappings: string[];
}

export interface TaskFilter {
  id: number;
  name: string;
  position: number;
  jiraMappings: string[];
}

export interface StatusSettings {
  categories: StatusCategory[];
  filters: TaskFilter[];
  defaultColor: string;
}

// Legacy types (for backwards compatibility)
export interface StatusConfig {
  name: string;
  color: string | null;
  order: number;
  isCompleted: boolean;
  isDefault?: boolean;
  filter?: string | null;
  jiraMapping?: string[];
}

export interface StatusConfigResponse {
  statuses: StatusConfig[];
  defaultColor: string;
}

export interface FetchStatusesResponse extends StatusConfigResponse {
  fetched: number;
  unmapped: string[];
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
  unchanged: number;
}

export interface MatchResult {
  merged: number;
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
