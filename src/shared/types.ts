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
  parentKey: string | null;
  jiraSyncedAt: string | null;

  // Manual flags
  highPriority: number | null;
  onIce: number | null;
  onIceReason: string | null;

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
  onDeploymentBranches: string | null; // JSON array of deployment branches PR is on (detected via commit history)
  labelOnlyDeploymentBranches: string | null; // JSON array of deployment branches detected via PR labels (full set, for badge coloring)
  deployedOnBranches: string | null; // JSON array of deployment branches where this PR's code is actually deployed
  unresolvedCommentCount: number | null;
  hasConflicts: number | null;
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
  choreSkips: string | null; // JSON: {"fix-pr-checks": true, ...}
}

// Task detail with relations
export interface TaskDetail extends Task {
  todos: Todo[];
  repository: Repository | null;
}

// Task with repository for curation view
export interface TaskWithRepository extends Task {
  repository: Repository | null;
}

// Task with pending todos for dashboard
export interface TaskWithTodos extends Task {
  pendingTodos: NextTodo[];
  repository: Repository | null;
}

export interface Todo {
  id: number;
  content: string;
  done: string | null;
  taskId: number | null;
  position: number | null;
  createdAt: string;
  updatedAt: string;
  isCustomChore: number | null; // 1 = custom chore, 0/null = regular todo
  choreRank: number | null; // chore definition number this runs before
  chorePrompt: string | null; // custom action text
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
  alias: string | null;
  enabled: number;
  badgeColor: string | null;
  deploymentBranches: string | null; // JSON array of branch names
  deploymentUrls: string | null; // JSON object mapping branch -> environment URL
  slackChannel: string | null; // Slack channel for review requests
  requiredReviews: number | null; // number of approving reviews required to merge (default 2)
  worktrees?: Worktree[];
}

export interface TeamChannel {
  id: number;
  githubTeamSlug: string;
  slackChannel: string;
}

export interface Worktree {
  id: number;
  repositoryId: number;
  path: string;
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

// Review request - PR where user is requested as reviewer
export interface FileChanges {
  files: number;
  additions: number;
  deletions: number;
}

export interface ReviewRequest {
  prNumber: number;
  title: string;
  url: string;
  repo: { owner: string; repo: string };
  author: string;
  state: "open" | "draft";
  isDraft: boolean;
  approvedCount: number;
  requiredReviews: number;
  hasPendingReview: boolean;
  createdAt: string;
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
  changesByCategory: { frontend: FileChanges; backend: FileChanges; other: FileChanges } | null;
  taskId: number | null;
  taskJiraKey: string | null;
}

export interface FileChangesWithPercent extends FileChanges {
  percent: number;
}

export type PrSize = "small" | "medium" | "large";

export interface PrChangesByCategory {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  size: PrSize;
  frontend: FileChangesWithPercent;
  backend: FileChangesWithPercent;
  other: FileChangesWithPercent;
}

// Helper type guard
export function isMergedTask(task: Task): boolean {
  return task.jiraKey !== null && task.prNumber !== null;
}
