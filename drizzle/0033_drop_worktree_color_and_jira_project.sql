ALTER TABLE worktrees DROP COLUMN color;
DELETE FROM settings WHERE key = 'jira_project';
