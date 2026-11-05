-- Jira "is blocked by" links, JSON [{key, status}] (status = the blocker's Jira status at last sync).
ALTER TABLE `tasks` ADD `blocked_by` text;
