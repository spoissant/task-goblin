-- The Merge button merges directly; GitHub auto-merge is no longer used.
ALTER TABLE `tasks` DROP COLUMN `auto_merge_enabled_at`;
