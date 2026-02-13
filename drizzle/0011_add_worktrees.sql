CREATE TABLE `worktrees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repository_id` integer NOT NULL REFERENCES `repositories`(`id`) ON DELETE cascade,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO worktrees (repository_id, path, created_at, updated_at)
SELECT id, local_path, datetime('now'), datetime('now')
FROM repositories WHERE local_path IS NOT NULL AND local_path != '';
--> statement-breakpoint
ALTER TABLE `repositories` DROP COLUMN `local_path`;
