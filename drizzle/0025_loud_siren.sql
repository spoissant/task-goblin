CREATE TABLE `team_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_team_slug` text NOT NULL,
	`slack_channel` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_channels_github_team_slug_unique` ON `team_channels` (`github_team_slug`);