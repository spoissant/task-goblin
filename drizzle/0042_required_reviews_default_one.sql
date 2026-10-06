-- Company policy now requires 1 approving review by default. SQLite can't alter a
-- column default, so rebuild repositories with required_reviews DEFAULT 1.
PRAGMA foreign_keys=OFF;
CREATE TABLE `__new_repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`alias` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`badge_color` text,
	`deployment_branches` text,
	`deployment_urls` text,
	`slack_channel` text,
	`required_reviews` integer DEFAULT 1,
	`setup_command` text,
	`teardown_command` text,
	`default_base_branch` text
);
INSERT INTO `__new_repositories` (id, owner, repo, alias, enabled, badge_color, deployment_branches, deployment_urls, slack_channel, required_reviews, setup_command, teardown_command, default_base_branch)
  SELECT id, owner, repo, alias, enabled, badge_color, deployment_branches, deployment_urls, slack_channel, required_reviews, setup_command, teardown_command, default_base_branch FROM `repositories`;
DROP TABLE `repositories`;
ALTER TABLE `__new_repositories` RENAME TO `repositories`;
PRAGMA foreign_keys=ON;
