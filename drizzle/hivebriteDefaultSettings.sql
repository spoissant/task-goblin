-- Default Hivebrite settings seed
-- Run with: sqlite3 task-goblin.db < drizzle/hivebriteDefaultSettings.sql

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('jira_host', 'https://hivebrite.atlassian.net/'),
  ('jira_email', 'simon.poissant@hivebrite.com'),
  ('jira_project', 'EV'),
  ('jira_jql', ''),
  ('github_username', 'spoissant');

INSERT OR REPLACE INTO repositories (id, owner, repo, enabled) VALUES
  (1, 'Hivebrite', 'alumni_connect', 1),
  (2, 'Hivebrite', 'front-monorepo', 1);
