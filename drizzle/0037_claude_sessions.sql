-- Stale leftovers from the removed agents feature (never covered by 0018's DROP TABLE agents)
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS agent_triggers;
ALTER TABLE tasks DROP COLUMN agent_status;
ALTER TABLE tasks DROP COLUMN agent_session_id;
ALTER TABLE tasks DROP COLUMN agent_started_at;
ALTER TABLE tasks DROP COLUMN agent_error;

-- Per-repository worktree lifecycle configuration
ALTER TABLE repositories ADD COLUMN setup_command TEXT;
ALTER TABLE repositories ADD COLUMN teardown_command TEXT;
ALTER TABLE repositories ADD COLUMN default_base_branch TEXT;

-- One git worktree per task, created on first AI session start
CREATE TABLE task_worktrees (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id),
  path TEXT NOT NULL,
  branch TEXT,
  state TEXT NOT NULL,
  setup_log TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT
);

-- Background Claude Code sessions, one row per chore run
CREATE TABLE claude_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repository_id INTEGER REFERENCES repositories(id),
  chore_key TEXT NOT NULL,
  chore_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  name TEXT NOT NULL,
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
CREATE INDEX idx_claude_sessions_task_id ON claude_sessions(task_id);
CREATE INDEX idx_claude_sessions_state ON claude_sessions(state);
