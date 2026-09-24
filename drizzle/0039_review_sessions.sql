-- PR reviews started from the Reviews page run without a task: task_id becomes
-- nullable (SQLite needs a table rebuild for that) and pr_url names the PR.
PRAGMA foreign_keys=OFF;

CREATE TABLE claude_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  pr_url TEXT,
  repository_id INTEGER REFERENCES repositories(id),
  chore_key TEXT NOT NULL,
  chore_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  name TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  short_id TEXT UNIQUE,
  session_id TEXT,
  bridge_session_id TEXT,
  state TEXT NOT NULL,
  detail TEXT,
  needs TEXT,
  result TEXT,
  error TEXT,
  claude_updated_at TEXT,
  first_terminal_at TEXT,
  process_stopped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO claude_sessions_new (
  id, task_id, repository_id, chore_key, chore_name, prompt, cwd, name, model, effort,
  short_id, session_id, bridge_session_id, state, detail, needs, result, error,
  claude_updated_at, first_terminal_at, process_stopped_at, created_at, updated_at
)
SELECT
  id, task_id, repository_id, chore_key, chore_name, prompt, cwd, name, model, effort,
  short_id, session_id, bridge_session_id, state, detail, needs, result, error,
  claude_updated_at, first_terminal_at, process_stopped_at, created_at, updated_at
FROM claude_sessions;

DROP TABLE claude_sessions;
ALTER TABLE claude_sessions_new RENAME TO claude_sessions;

CREATE INDEX idx_claude_sessions_task_id ON claude_sessions(task_id);
CREATE INDEX idx_claude_sessions_pr_url ON claude_sessions(pr_url);
CREATE INDEX idx_claude_sessions_state ON claude_sessions(state);

PRAGMA foreign_keys=ON;
