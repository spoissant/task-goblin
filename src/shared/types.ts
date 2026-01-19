// Task status enum
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "code_review"
  | "qa"
  | "done"
  | "blocked";


// PR state
export type PullRequestState = "open" | "closed" | "merged";

// Check status
export type ChecksStatus = "passing" | "failing" | "pending";

// Review status
export type ReviewStatus = "approved" | "changes_requested" | "pending";

// ============ Request Types ============

export interface CreateTaskRequest {
  title: string;
  description?: string;
  status?: TaskStatus;
}

export interface UpdateTaskRequest {
  title: string;
  description?: string | null;
  status?: TaskStatus;
}

export interface PatchTaskRequest {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
}

export interface CreateTodoRequest {
  content: string;
  done?: string | null;
  taskId?: number | null;
  branchId?: number | null;
  jiraItemId?: number | null;
  pullRequestId?: number | null;
}

export interface UpdateTodoRequest {
  content: string;
  done?: string | null;
  taskId?: number | null;
  branchId?: number | null;
  jiraItemId?: number | null;
  pullRequestId?: number | null;
}

export interface CreateBlockedByRequest {
  blockedTaskId?: number | null;
  blockedBranchId?: number | null;
  blockerTaskId?: number | null;
  blockerTodoId?: number | null;
  blockerBranchId?: number | null;
}

export interface CreateBranchRequest {
  name: string;
  repositoryId: number;
  taskId: number;
  pullRequestId?: number | null;
}

export interface CreateRepositoryRequest {
  owner: string;
  repo: string;
  enabled?: boolean;
}

export interface CreateSettingRequest {
  key: string;
  value?: string | null;
}

export interface JiraConfigRequest {
  jira_host?: string | null;
  jira_email?: string | null;
  jira_project?: string | null;
  jira_jql?: string | null;
}

export interface LinkRequest {
  taskId?: number;
  branchId?: number;
}

// ============ Response Types ============

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithRelations extends Task {
  todos: Todo[];
  branches: Branch[];
  jiraItems: JiraItem[];
  blockedBy: BlockedByRecord[];
}

export interface Todo {
  id: number;
  content: string;
  done: string | null;
  taskId: number | null;
  branchId: number | null;
  jiraItemId: number | null;
  pullRequestId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlockedByRecord {
  id: number;
  blockedTaskId: number | null;
  blockedBranchId: number | null;
  blockerTaskId: number | null;
  blockerTodoId: number | null;
  blockerBranchId: number | null;
}

export interface Branch {
  id: number;
  name: string;
  repositoryId: number;
  taskId: number;
  pullRequestId: number | null;
}

export interface BranchWithRelations extends Branch {
  repository: Repository | null;
  pullRequest: PullRequest | null;
}

export interface Repository {
  id: number;
  owner: string;
  repo: string;
  enabled: number;
}

export interface Setting {
  key: string;
  value: string | null;
}

export interface JiraItem {
  id: number;
  key: string;
  summary: string;
  description: string | null;
  status: string;
  type: string | null;
  assignee: string | null;
  priority: string | null;
  sprint: string | null;
  epicKey: string | null;
  lastComment: string | null;
  taskId: number | null;
  updatedAt: string;
}

export interface PullRequest {
  id: number;
  number: number;
  repositoryId: number;
  title: string;
  state: string;
  author: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  isDraft: number;
  checksStatus: string | null;
  reviewStatus: string | null;
  updatedAt: string;
}

export interface PullRequestWithRelations extends PullRequest {
  repository: Repository | null;
  branches: Branch[];
}

// List responses
export interface ListResponse<T> {
  items: T[];
  total: number;
}

// Sync response
export interface SyncResponse {
  synced: number;
  new: number;
  updated: number;
}

// Error response
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// Health response
export interface HealthResponse {
  status: "ok";
  timestamp: string;
}
