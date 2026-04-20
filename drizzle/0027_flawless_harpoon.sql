ALTER TABLE `todos` ADD `is_custom_chore` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `todos` ADD `chore_rank` integer;--> statement-breakpoint
ALTER TABLE `todos` ADD `chore_prompt` text;