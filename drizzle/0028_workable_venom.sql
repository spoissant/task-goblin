CREATE INDEX `idx_note_tasks_note_id` ON `note_tasks` (`note_id`);--> statement-breakpoint
CREATE INDEX `idx_note_tasks_task_id` ON `note_tasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_repository_id` ON `tasks` (`repository_id`);--> statement-breakpoint
CREATE INDEX `idx_todos_task_id` ON `todos` (`task_id`);