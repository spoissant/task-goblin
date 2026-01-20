DROP TABLE `jira_items`;--> statement-breakpoint
DROP TABLE `pull_requests`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_blocked_by` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`blocked_task_id` integer,
	`blocker_task_id` integer,
	`blocker_todo_id` integer,
	FOREIGN KEY (`blocked_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocker_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocker_todo_id`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_blocked_by`("id", "blocked_task_id", "blocker_task_id", "blocker_todo_id") SELECT "id", "blocked_task_id", "blocker_task_id", "blocker_todo_id" FROM `blocked_by`;--> statement-breakpoint
DROP TABLE `blocked_by`;--> statement-breakpoint
ALTER TABLE `__new_blocked_by` RENAME TO `blocked_by`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`done` text,
	`task_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_todos`("id", "content", "done", "task_id", "created_at", "updated_at") SELECT "id", "content", "done", "task_id", "created_at", "updated_at" FROM `todos`;--> statement-breakpoint
DROP TABLE `todos`;--> statement-breakpoint
ALTER TABLE `__new_todos` RENAME TO `todos`;--> statement-breakpoint
ALTER TABLE `tasks` ADD `jira_key` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `type` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `sprint` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `epic_key` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_comment` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `jira_synced_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pr_number` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `repository_id` integer REFERENCES repositories(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `head_branch` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `base_branch` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pr_state` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pr_author` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `is_draft` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `tasks` ADD `checks_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `review_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pr_synced_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_jira_key_unique` ON `tasks` (`jira_key`);