-- Jira epics tied to a goal: unassigned tasks in these epics join the goal when they sync.
ALTER TABLE `goals` ADD `epic_keys` text DEFAULT '[]' NOT NULL;
