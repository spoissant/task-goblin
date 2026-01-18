CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`plan_file` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
