import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 1. Task - Unified table for manual tasks, Jira items, and PRs
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | code_review | qa | done | blocked
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // Jira fields (nullable - set when jiraKey present)
  jiraKey: text("jira_key").unique(), // "PROJ-123"
  type: text("type"), // Story, Bug, Task
  assignee: text("assignee"),
  priority: text("priority"),
  sprint: text("sprint"), // sprint name
  epicKey: text("epic_key"), // parent epic key
  lastComment: text("last_comment"), // most recent comment body
  jiraSyncedAt: text("jira_synced_at"),

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
  reviewStatus: text("review_status"), // approved | changes_requested | pending
  approvedReviewCount: integer("approved_review_count"),
  prSyncedAt: text("pr_synced_at"),
});

// 2. Todo - Checklist items linked only to tasks
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  done: text("done"), // ISO timestamp when completed, null if pending
  taskId: integer("task_id").references(() => tasks.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// 3. Repository - GitHub repo configs
export const repositories = sqliteTable("repositories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  owner: text("owner").notNull(), // GitHub org/user
  repo: text("repo").notNull(), // repo name
  enabled: integer("enabled").notNull().default(1), // SQLite bool
});

// 4. BlockedBy - Explicit FK blocking relationships (tasks only)
export const blockedBy = sqliteTable("blocked_by", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // What is blocked (must be a task)
  blockedTaskId: integer("blocked_task_id").references(() => tasks.id),
  // What is blocking (one must be set)
  blockerTaskId: integer("blocker_task_id").references(() => tasks.id),
  blockerTodoId: integer("blocker_todo_id").references(() => todos.id),
});

// 5. Settings - Key-value config store
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});
