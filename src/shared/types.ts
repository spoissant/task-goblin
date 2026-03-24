// Shared types for client, server, and MCP

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

  // Manual flags
  highPriority: number | null;

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
  hasConflicts: number | null;
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
}

// Linked note summary (id + title only)
export interface LinkedNote {
  id: number;
  title: string;
}

// Task detail with relations
export interface TaskDetail extends Task {
  todos: Todo[];
  repository: Repository | null;
  notes: LinkedNote[];
}

// Task with repository for curation view
export interface TaskWithRepository extends Task {
  repository: Repository | null;
}

// Task with pending todos for dashboard
export interface TaskWithTodos extends Task {
  pendingTodos: NextTodo[];
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
  worktrees?: Worktree[];
}

export interface Worktree {
  id: number;
  repositoryId: number;
  path: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

// Deploy types
export interface DeployResult {
  status: "success";
  targetBranch: string;
  sourceBranch: string;
  commitSha: string;
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

export interface Settings {
  [key: string]: string | null;
}

export interface JiraConfig {
  jira_host: string | null;
  jira_email: string | null;
  jira_project: string | null;
  jira_jql: string | null;
  jira_sprint_field?: string | null;
}

// Status Settings types
export interface StatusCategory {
  id: number;
  name: string;
  color: string;
  done: boolean;
  displayOrder: number;
  jiraMappings: string[];
}

export interface StatusSettings {
  categories: StatusCategory[];
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

export interface SplitResult {
  jiraTask: Task;
  prTask: Task;
}

// Note - standalone markdown document for investigation notes, failed attempts, decisions
export interface Note {
  id: number;
  title: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

// Note with linked tasks
export interface NoteWithTasks extends Note {
  tasks: { id: number; title: string; jiraKey: string | null }[];
}

// Note-Task junction record
export interface NoteTask {
  id: number;
  noteId: number;
  taskId: number;
}

// Review request - PR where user is requested as reviewer
export interface ReviewRequest {
  prNumber: number;
  title: string;
  url: string;
  repo: { owner: string; repo: string };
  author: string;
  state: "open" | "draft";
  isDraft: boolean;
  approvedCount: number;
  createdAt: string;
}

// Helper type guard
export function isMergedTask(task: Task): boolean {
  return task.jiraKey !== null && task.prNumber !== null;
}
