CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`worktree_id` integer NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`system_prompt` text,
	`allowed_tools` text,
	`model` text,
	`max_turns` integer,
	`permission_mode` text DEFAULT 'default' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_worktree_id_unique` ON `agents` (`worktree_id`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repository_id` integer NOT NULL,
	`agent_id` integer,
	`task_id` integer,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`position` integer,
	`output` text,
	`error_message` text,
	`session_id` text,
	`cost_usd` text,
	`duration_ms` integer,
	`input_request` text,
	`input_response` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
