CREATE TABLE `blocked_by` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`blocked_task_id` integer,
	`blocked_pull_request_id` integer,
	`blocker_task_id` integer,
	`blocker_todo_id` integer,
	`blocker_pull_request_id` integer,
	FOREIGN KEY (`blocked_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocker_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocker_todo_id`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocker_pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jira_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`summary` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`type` text,
	`assignee` text,
	`priority` text,
	`sprint` text,
	`epic_key` text,
	`last_comment` text,
	`task_id` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jira_items_key_unique` ON `jira_items` (`key`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer,
	`repository_id` integer NOT NULL,
	`task_id` integer,
	`title` text,
	`state` text,
	`author` text,
	`head_branch` text NOT NULL,
	`base_branch` text,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`checks_status` text,
	`review_status` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`done` text,
	`task_id` integer,
	`jira_item_id` integer,
	`pull_request_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`jira_item_id`) REFERENCES `jira_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
