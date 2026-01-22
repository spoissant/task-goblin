CREATE TABLE `status_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`display_order` integer NOT NULL,
	`jira_mappings` text
);
--> statement-breakpoint
CREATE TABLE `task_filters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`jira_mappings` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_filters_name_unique` ON `task_filters` (`name`);