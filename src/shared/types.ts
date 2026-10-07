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
  uncommittedFiles: number | null; // task worktree, refreshed on GitHub sync; null without a worktree
  unpushedCommits: number | null; // task worktree commits not on any remote
  choreSkips: string | null; // JSON: {"fix-pr-checks": true, ...}
}

// Task detail with relations
export interface TaskDetail extends Task {
  repository: Repository | null;
}

// Task with repository for curation view
export interface TaskWithRepository extends Task {
  repository: Repository | null;
}

// Task row for dashboard lists
export interface TaskListItem extends Task {
  repository: Repository | null;
  hasChildren: boolean; // another task points at this one via parentKey or epicKey
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
  requiredReviews: number | null; // number of approving reviews required to merge (default 1)
  setupCommand: string | null; // shell line run inside a new task worktree
  teardownCommand: string | null; // shell line run before removing a task worktree; may use {{composeProject}}
  defaultBaseBranch: string | null; // base branch for tasks without a branch yet
  worktrees?: Worktree[];
}

// Per-task git worktree, created on first AI session start
export type TaskWorktreeState = "preparing" | "ready" | "failed" | "dirty" | "removing";

export interface TaskWorktree {
  id: number;
  taskId: number;
  repositoryId: number;
  path: string;
  branch: string | null; // null only for older worktrees created detached
  state: TaskWorktreeState;
  setupLog: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
}

export interface TaskWorktreeStatus extends TaskWorktree {
  changedFiles: number | null; // live git status count; null when unavailable
}

// Dev stack: the single local stack booted from a task branch in the repo's main checkout
/** Who the dev stack is booted for: a task, or a PR that has no task. */
export type DevStackOwner = { taskId: number } | { prUrl: string };

export type DevStackState = "starting" | "up" | "stopping" | "failed";

export interface DevStack {
  taskId: number | null;
  prUrl: string | null; // owner when booted from a PR without a task (Reviews page)
  repositoryId: number; // one stack per repository
  branch: string; // task branch, or "repo#N" for a PR
  mergedTaskIds: number[]; // other tasks whose branches are merged on top of the owner's; each counts as an owner
  state: DevStackState;
  pid: number | null;
  alive: boolean; // boot process still running (checked on read)
  detail: string | null; // current boot phase while starting
  error: string | null;
  startedAt: string;
  logTail: string; // tail of logs/dev-stack.log
  url: string; // where the booted app is served
}

export interface DevStackStatus {
  supported: boolean; // this task's repository can boot a dev stack
  stack: DevStack | null; // this repository's stack, whichever task or PR owns it
}

export interface DevStackRefresh {
  from: string; // short sha before the refresh
  to: string; // short sha after; equal to `from` when already up to date
}

export type DevStackLoginAs = "member" | "admin" | "super_admin";

export interface DevStackLoginLink {
  url: string; // single-use claim link, valid 10 minutes
  subjectId: number; // user, admin or super admin signed in
  name: string;
  networkId: number;
}

export interface DevStackOverview {
  supportedRepositoryIds: number[]; // repositories whose tasks and PRs may boot a stack
  stacks: DevStack[]; // at most one per repository
}

// Background Claude Code session, one per chore run
export type ClaudeSessionState = "queued" | "preparing" | "working" | "blocked" | "done" | "failed" | "stopped";

/** `claude --model` aliases offered for custom-prompt sessions. */
export const SESSION_MODELS = ["opus", "sonnet", "fable", "haiku"] as const;
export type SessionModel = (typeof SESSION_MODELS)[number];

/** `claude --effort` levels. */
export const SESSION_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type SessionEffort = (typeof SESSION_EFFORTS)[number];

export interface ClaudeSession {
  id: number;
  taskId: number | null; // null for PR reviews started from the Reviews page
  prUrl: string | null;
  repositoryId: number | null;
  choreKey: string;
  choreName: string;
  prompt: string;
  cwd: string;
  name: string;
  model: string | null;
  effort: string | null;
  shortId: string | null;
  sessionId: string | null;
  bridgeSessionId: string | null;
  link: string | null; // https://claude.ai/code/session_XXX, derived from bridgeSessionId
  state: ClaudeSessionState;
  detail: string | null;
  needs: string | null;
  result: string | null;
  error: string | null;
  claudeUpdatedAt: string | null;
  firstTerminalAt: string | null;
  processStoppedAt: string | null;
  costUsd: number | null; // API-list-price equivalent, from the transcript
  activeMs: number | null; // time Claude spent working, summed over turns
  turnCount: number | null;
  subagentCount: number | null;
  usageCollectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One collected session for the analytics page; model and effort are what the main agent mostly ran on. */
export interface SessionAnalyticsRow {
  id: number;
  taskId: number | null;
  task: string; // Jira key, or the session name's prefix (e.g. "ac#123" for a PR review)
  taskTitle: string | null;
  chore: string;
  repo: string | null;
  model: string | null; // e.g. "opus-5-5"
  effort: string | null;
  createdAt: string;
  costUsd: number | null;
  activeMs: number | null;
  turnCount: number | null;
  subagentCount: number | null;
}

/**
 * One day of session parallelism: how many 5-minute slots saw an API request,
 * and how many (slot, session) and (slot, agent) pairs there were. Dividing the
 * pairs by the slots gives the average number of sessions (or agents, sub-agents
 * included) working at the same time while anything was working at all.
 */
export interface ConcurrencyDay {
  day: string; // YYYY-MM-DD, UTC
  slots: number;
  sessionSlots: number;
  agentSlots: number;
}

/** A session listed across tasks, carrying its task's title (null for PR reviews). */
export interface RecentClaudeSession extends ClaudeSession {
  taskTitle: string | null;
}

export interface RepositoryGuess {
  repositoryId: number | null;
  reason: "title-keyword" | "jira-project" | "only-enabled-repo" | null;
  candidates: { repositoryId: number; count: number }[];
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
  new: number;
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

/** A GitHub team the token user belongs to. */
export interface GitHubTeam {
  org: string;
  slug: string;
  name: string;
}

/**
 * Where one of your teams stands on reviewing a PR:
 * - blocking: the team owns changed files and the PR can't merge until it reviews
 * - reviewed: a member of the team has already reviewed on the team's behalf
 * - optional: the team was asked, but its review doesn't gate the merge
 */
export type CodeownerState = "blocking" | "reviewed" | "optional";

/** Your teams involved in a PR's review, each with its own state. Empty when none was asked. */
export type CodeownerReview = Array<{ slug: string; state: CodeownerState }>;

export interface ReviewRequest {
  prNumber: number;
  title: string;
  url: string;
  repo: { owner: string; repo: string };
  author: string;
  state: "open" | "draft";
  isDraft: boolean;
  /** null when GitHub wouldn't return the PR's reviews — unknown, not zero. */
  approvedCount: number | null;
  requiredReviews: number;
  hasPendingReview: boolean;
  codeowner: CodeownerReview;
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
