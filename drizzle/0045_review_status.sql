-- GitHub's review verdict replaces the hand-set approval threshold: store it per
-- task, and drop the per-repo setting it made obsolete.
ALTER TABLE `tasks` ADD `review_status` text;
ALTER TABLE `repositories` DROP COLUMN `required_reviews`;
