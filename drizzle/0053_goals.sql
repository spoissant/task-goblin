-- Goals: umbrellas grouping tasks into sections on the Tasks page.
CREATE TABLE `goals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `context` text,
  `display_order` integer NOT NULL,
  `archived` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
-- The goal a task belongs to; null = unassigned. Deleting a goal unassigns its tasks.
ALTER TABLE `tasks` ADD `goal_id` integer REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX `idx_tasks_goal_id` ON `tasks` (`goal_id`);
