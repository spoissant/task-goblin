-- The merge gate keeps only its verdict (no hold reasons), and the merge watch no longer records the base build.
ALTER TABLE `tasks` ADD `merge_ready` integer DEFAULT 0 NOT NULL;
UPDATE `tasks` SET `merge_ready` = 1 WHERE json_valid(`merge_hold`) AND json_array_length(`merge_hold`, '$.reasons') = 0;
ALTER TABLE `tasks` DROP COLUMN `merge_hold`;
ALTER TABLE `tasks` DROP COLUMN `base_build_state`;
ALTER TABLE `tasks` DROP COLUMN `base_build_url`;
-- Columns nothing reads: the old /next reservation, Jira sync time, PR author and approval count, worktree ready time.
ALTER TABLE `tasks` DROP COLUMN `working_on`;
ALTER TABLE `tasks` DROP COLUMN `jira_synced_at`;
ALTER TABLE `tasks` DROP COLUMN `pr_author`;
ALTER TABLE `tasks` DROP COLUMN `approved_review_count`;
ALTER TABLE `task_worktrees` DROP COLUMN `ready_at`;
-- Statuses are Jira or category names: move the last tasks off the old underscore names.
UPDATE `tasks` SET `status` = 'Done' WHERE `status` = 'done';
UPDATE `tasks` SET `status` = 'In Progress' WHERE `status` = 'in_progress';
UPDATE `tasks` SET `status` = 'Code Review' WHERE `status` = 'code_review';
UPDATE `tasks` SET `status` = 'To Do' WHERE `status` = 'todo';
DELETE FROM `settings` WHERE `key` = 'status_migration_v1';
-- The Assign Jira Ticket chore is gone.
UPDATE `settings` SET `value` = json_remove(`value`, '$."assign-jira-ticket"') WHERE `key` = 'chore_models' AND json_valid(`value`);
-- Migrations are applied by hand with sqlite3; drizzle-kit migrate's bookkeeping is unused.
DROP TABLE IF EXISTS `__drizzle_migrations`;
