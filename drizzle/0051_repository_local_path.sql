-- A repository's main checkout path moves from the worktrees table (one row per repository) to repositories.local_path.
ALTER TABLE `repositories` ADD `local_path` text;
UPDATE `repositories` SET `local_path` = (
  SELECT `path` FROM `worktrees` WHERE `worktrees`.`repository_id` = `repositories`.`id` ORDER BY `worktrees`.`id` LIMIT 1
);
DROP TABLE `worktrees`;
