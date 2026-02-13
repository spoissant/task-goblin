ALTER TABLE `tasks` ADD `has_conflicts` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `instructions`;