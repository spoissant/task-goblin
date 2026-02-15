-- Add permission_mode to prompts table
ALTER TABLE `prompts` ADD `permission_mode` text NOT NULL DEFAULT 'default';

-- Copy agent's permission_mode to all its pending prompts
UPDATE `prompts`
SET `permission_mode` = (
  SELECT COALESCE(`agents`.`permission_mode`, 'default')
  FROM `agents`
  WHERE `agents`.`id` = `prompts`.`agent_id`
)
WHERE `prompts`.`agent_id` IS NOT NULL
  AND `prompts`.`status` = 'pending';

-- SQLite doesn't support DROP COLUMN directly in older versions,
-- but Bun's SQLite (based on newer SQLite 3.35+) does.
ALTER TABLE `agents` DROP COLUMN `permission_mode`;
