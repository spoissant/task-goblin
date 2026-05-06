import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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

  // Automation flags (not synced from Jira/GitHub)
  choreSkips: text("chore_skips"), // JSON: {"fix-pr-checks": true, "address-pr-comments": true, ...}
  workingOn: text("working_on"), // JSON: {"choreKey": "request-reviews", "at": "2026-04-20T14:00:00Z"} or null
}, (table) => [
  index("idx_tasks_repository_id").on(table.repositoryId),
]);

// 2. Todo - Checklist items linked only to tasks
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  done: text("done"), // ISO timestamp when completed, null if pending
  taskId: integer("task_id").references(() => tasks.id),
  position: integer("position"), // global ordering for all todos
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  isCustomChore: integer("is_custom_chore").default(0), // 1 = custom chore, 0 = regular todo
  choreRank: integer("chore_rank"), // chore definition number this runs before (e.g. 5 = runs before chore #5)
  chorePrompt: text("chore_prompt"), // custom action text
}, (table) => [
  index("idx_todos_task_id").on(table.taskId),
]);

// 3. Repository - GitHub repo configs
export const repositories = sqliteTable("repositories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  owner: text("owner").notNull(), // GitHub org/user
  repo: text("repo").notNull(), // repo name
  enabled: integer("enabled").notNull().default(1), // SQLite bool
  badgeColor: text("badge_color"), // Tailwind color name for badge display (e.g., "blue", "green", "purple")
  deploymentBranches: text("deployment_branches"), // JSON array of deployment branch names (e.g., ["staging", "qa"])
  deploymentUrls: text("deployment_urls"), // JSON object mapping branch -> environment URL (e.g., {"staging": "https://staging.hvbrt.com"})
  slackChannel: text("slack_channel"), // Slack channel name for review requests (e.g., "team-backend-prs")
});

// 3b. Worktree - Local filesystem paths per repository
export const worktrees = sqliteTable("worktrees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repositoryId: integer("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  color: text("color"), // Tailwind color name for visual identification
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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


