import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 1. Task - Core workflow-level entity
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | code_review | qa | done | blocked
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// 2. Todo - Checklist items with explicit FK relations
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  done: text("done"), // ISO timestamp when completed, null if pending
  taskId: integer("task_id").references(() => tasks.id),
  branchId: integer("branch_id").references(() => branches.id),
  jiraItemId: integer("jira_item_id").references(() => jiraItems.id),
  pullRequestId: integer("pull_request_id").references(() => pullRequests.id),
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

// 4. Branch - Git branches linked to tasks
export const branches = sqliteTable("branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  repositoryId: integer("repository_id")
    .notNull()
    .references(() => repositories.id),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id),
  pullRequestId: integer("pull_request_id").references(() => pullRequests.id),
});

// 5. JiraItem - Synced Jira issues
export const jiraItems = sqliteTable("jira_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(), // "PROJ-123"
  summary: text("summary").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  type: text("type"), // Story, Bug, Task
  assignee: text("assignee"),
  priority: text("priority"),
  sprint: text("sprint"), // sprint name
  epicKey: text("epic_key"), // parent epic key
  lastComment: text("last_comment"), // most recent comment body
  taskId: integer("task_id").references(() => tasks.id),
  updatedAt: text("updated_at").notNull(), // last sync time
});

// 6. PullRequest - Synced GitHub PRs
export const pullRequests = sqliteTable("pull_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: integer("number").notNull(), // PR number
  repositoryId: integer("repository_id")
    .notNull()
    .references(() => repositories.id),
  title: text("title").notNull(),
  state: text("state").notNull(), // open | closed | merged
  author: text("author"),
  headBranch: text("head_branch"),
  baseBranch: text("base_branch"),
  isDraft: integer("is_draft").notNull().default(0),
  checksStatus: text("checks_status"), // passing | failing | pending
  reviewStatus: text("review_status"), // approved | changes_requested | pending
  updatedAt: text("updated_at").notNull(),
});

// 7. BlockedBy - Explicit FK blocking relationships
export const blockedBy = sqliteTable("blocked_by", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // What is blocked (one must be set)
  blockedTaskId: integer("blocked_task_id").references(() => tasks.id),
  blockedBranchId: integer("blocked_branch_id").references(() => branches.id),
  // What is blocking (one must be set)
  blockerTaskId: integer("blocker_task_id").references(() => tasks.id),
  blockerTodoId: integer("blocker_todo_id").references(() => todos.id),
  blockerBranchId: integer("blocker_branch_id").references(() => branches.id),
});

// 8. Settings - Key-value config store
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});
