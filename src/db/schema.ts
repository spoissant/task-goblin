import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// 1. Task - Unified table for manual tasks, Jira items, and PRs
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | code_review | qa | done | blocked | ready_to_merge
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // Jira fields (nullable - set when jiraKey present)
  jiraKey: text("jira_key").unique(), // "PROJ-123"
  type: text("type"), // Story, Bug, Task
  assignee: text("assignee"),
  priority: text("priority"),
  sprint: text("sprint"), // sprint name
  epicKey: text("epic_key"), // parent epic key
  parentKey: text("parent_key"), // non-epic parent key (e.g. sub-task's parent story/bug)
  jiraSyncedAt: text("jira_synced_at"),

  // Manual flags (not synced from Jira/GitHub)
  highPriority: integer("high_priority").default(0),
  onIce: integer("on_ice").default(0),
  onIceReason: text("on_ice_reason"),

  // GitHub/PR fields (nullable - set when prNumber present)
  prNumber: integer("pr_number"),
  repositoryId: integer("repository_id").references(() => repositories.id),
  headBranch: text("head_branch"),
  baseBranch: text("base_branch"),
  prState: text("pr_state"), // open | closed | merged
  prAuthor: text("pr_author"),
  isDraft: integer("is_draft").default(0),
  checksStatus: text("checks_status"), // passing | failing | pending
  checksDetails: text("checks_details"), // JSON array of check details
  approvedReviewCount: integer("approved_review_count"),
  prSyncedAt: text("pr_synced_at"),
  onDeploymentBranches: text("on_deployment_branches"), // JSON array of deployment branches PR is on (detected via commit history)
  labelOnlyDeploymentBranches: text("label_only_deployment_branches"), // JSON array of deployment branches detected via PR labels (full set, used for badge coloring)
  deployedOnBranches: text("deployed_on_branches"), // JSON array of deployment branches where this PR's code is actually deployed
  unresolvedCommentCount: integer("unresolved_comment_count").default(0),
  hasConflicts: integer("has_conflicts").default(0),
  changedFiles: integer("changed_files"),
  additions: integer("additions"),
  deletions: integer("deletions"),
  uncommittedFiles: integer("uncommitted_files"), // task worktree, refreshed on GitHub sync; null without a worktree
  unpushedCommits: integer("unpushed_commits"), // task worktree commits not on any remote

  // Automation flags (not synced from Jira/GitHub)
  choreSkips: text("chore_skips"), // JSON: {"fix-pr-checks": true, "address-pr-comments": true, ...}
  workingOn: text("working_on"), // JSON: {"choreKey": "request-reviews", "at": "2026-04-20T14:00:00Z"} or null
}, (table) => [
  index("idx_tasks_repository_id").on(table.repositoryId),
]);

// 3. Repository - GitHub repo configs
export const repositories = sqliteTable("repositories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  owner: text("owner").notNull(), // GitHub org/user
  repo: text("repo").notNull(), // repo name
  alias: text("alias"), // optional short label used in UI instead of full repo name
  enabled: integer("enabled").notNull().default(1), // SQLite bool
  badgeColor: text("badge_color"), // Tailwind color name for badge display (e.g., "blue", "green", "purple")
  deploymentBranches: text("deployment_branches"), // JSON array of deployment branch names (e.g., ["staging", "qa"])
  deploymentUrls: text("deployment_urls"), // JSON object mapping branch -> environment URL (e.g., {"staging": "https://staging.hvbrt.com"})
  slackChannel: text("slack_channel"), // Slack channel name for review requests (e.g., "team-backend-prs")
  requiredReviews: integer("required_reviews").default(1), // number of approving reviews required to merge
  setupCommand: text("setup_command"), // shell line run inside a new task worktree (e.g. "bin/dev worktree-setup --copy-volumes --test-only && yarn install")
  teardownCommand: text("teardown_command"), // shell line run before removing a task worktree; may use {{composeProject}}
  defaultBaseBranch: text("default_base_branch"), // base for tasks without a branch yet (e.g. "sprint", "main")
});

// 3b. Worktree - Local filesystem paths per repository
export const worktrees = sqliteTable("worktrees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repositoryId: integer("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// 3c. Task worktree - one git worktree per task, created on first AI session start
export const taskWorktrees = sqliteTable("task_worktrees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().unique().references(() => tasks.id, { onDelete: "cascade" }),
  repositoryId: integer("repository_id").notNull().references(() => repositories.id),
  path: text("path").notNull(), // may start with ~ like worktrees.path
  branch: text("branch"), // null only for worktrees created detached before wt managed them
  state: text("state").notNull(), // preparing | ready | failed | dirty | removing
  setupLog: text("setup_log"), // tail of setup/teardown output
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  readyAt: text("ready_at"),
});

// 3d. Claude sessions - background Claude Code sessions, one row per chore run
export const claudeSessions = sqliteTable("claude_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }), // null for PR reviews started from the Reviews page
  prUrl: text("pr_url"), // PR reviewed by a task-less review session
  repositoryId: integer("repository_id").references(() => repositories.id),
  choreKey: text("chore_key").notNull(),
  choreName: text("chore_name").notNull(),
  prompt: text("prompt").notNull(), // resolved prompt snapshot
  cwd: text("cwd").notNull(), // task worktree or repo main checkout
  name: text("name").notNull(), // "<JIRA-KEY> · <chore name>"
  model: text("model"), // claude --model alias; null = CLI default
  effort: text("effort"), // claude --effort level; null = CLI default
  shortId: text("short_id").unique(), // claude --bg job id; null until spawned
  sessionId: text("session_id"),
  bridgeSessionId: text("bridge_session_id"), // cse_XXX → https://claude.ai/code/session_XXX
  state: text("state").notNull(), // queued | preparing | working | blocked | done | failed | stopped
  detail: text("detail"),
  needs: text("needs"),
  result: text("result"),
  error: text("error"), // our side: setup/spawn failure
  claudeUpdatedAt: text("claude_updated_at"),
  firstTerminalAt: text("first_terminal_at"),
  processStoppedAt: text("process_stopped_at"),
  // Usage totals, collected from the transcript (see session-usage.ts)
  costUsd: real("cost_usd"), // API-list-price equivalent; null when a request's model is unpriced
  activeMs: integer("active_ms"), // sum of turn durations: time Claude was working, not waiting
  turnCount: integer("turn_count"),
  subagentCount: integer("subagent_count"),
  usageCollectedAt: text("usage_collected_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_claude_sessions_task_id").on(table.taskId),
  index("idx_claude_sessions_pr_url").on(table.prUrl),
  index("idx_claude_sessions_state").on(table.state),
]);

// 3e. Claude session requests - one row per API request in a session's transcript, subagents included
export const claudeSessionRequests = sqliteTable("claude_session_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => claudeSessions.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  agentId: text("agent_id"), // null = main agent
  agentType: text("agent_type"), // subagent type, e.g. Explore
  timestamp: text("timestamp").notNull(),
  model: text("model").notNull(),
  effort: text("effort"),
  speed: text("speed"), // standard | fast
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  thinkingTokens: integer("thinking_tokens").notNull(), // included in outputTokens
  cacheWrite5mTokens: integer("cache_write_5m_tokens").notNull(),
  cacheWrite1hTokens: integer("cache_write_1h_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull(),
  webSearchRequests: integer("web_search_requests").notNull(),
  costUsd: real("cost_usd"), // at the price when collected; null when the model is unpriced
}, (table) => [
  uniqueIndex("idx_claude_session_requests_message").on(table.sessionId, table.messageId),
]);

// 4. Team Channels - maps GitHub team slugs to Slack channels for code review routing
export const teamChannels = sqliteTable("team_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  githubTeamSlug: text("github_team_slug").notNull().unique(), // e.g. "team-backend"
  slackChannel: text("slack_channel").notNull(), // e.g. "#team-backend-prs"
});

// 5. Settings - Key-value config store
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// 7. Status Categories - color + completion state + display order
export const statusCategories = sqliteTable("status_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  done: integer("done").notNull().default(0), // SQLite bool - true=CompletedPage, false=TasksPage
  displayOrder: integer("display_order").notNull(),
  jiraMappings: text("jira_mappings"), // JSON array
});


