-- Bulk chore sessions: the other tasks a session covers, each with its trigger state.
CREATE TABLE `claude_session_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`task_id` integer NOT NULL,
	`trigger_fingerprint` text,
	FOREIGN KEY (`session_id`) REFERENCES `claude_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_claude_session_tasks_session_id` ON `claude_session_tasks` (`session_id`);
CREATE INDEX `idx_claude_session_tasks_task_id` ON `claude_session_tasks` (`task_id`);
