-- Auto-started chores: which trigger started a session and on what task state.
ALTER TABLE `claude_sessions` ADD `trigger` text;
ALTER TABLE `claude_sessions` ADD `trigger_fingerprint` text;
-- Merge gate and post-merge watch state, on the task.
ALTER TABLE `tasks` ADD `head_sha` text;
ALTER TABLE `tasks` ADD `merge_commit_sha` text;
ALTER TABLE `tasks` ADD `auto_merge_enabled_at` text;
ALTER TABLE `tasks` ADD `merge_hold` text;
ALTER TABLE `tasks` ADD `base_build_state` text;
ALTER TABLE `tasks` ADD `base_build_url` text;
ALTER TABLE `tasks` ADD `merge_verified_at` text;
