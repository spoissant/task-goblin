-- Session usage: per-request token counts from the transcript, plus per-session totals
ALTER TABLE claude_sessions ADD COLUMN cost_usd REAL;
ALTER TABLE claude_sessions ADD COLUMN active_ms INTEGER;
ALTER TABLE claude_sessions ADD COLUMN turn_count INTEGER;
ALTER TABLE claude_sessions ADD COLUMN subagent_count INTEGER;
ALTER TABLE claude_sessions ADD COLUMN usage_collected_at TEXT;

CREATE TABLE claude_session_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES claude_sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  agent_id TEXT,
  agent_type TEXT,
  timestamp TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  speed TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  thinking_tokens INTEGER NOT NULL,
  cache_write_5m_tokens INTEGER NOT NULL,
  cache_write_1h_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  web_search_requests INTEGER NOT NULL,
  cost_usd REAL
);

CREATE UNIQUE INDEX idx_claude_session_requests_message ON claude_session_requests(session_id, message_id);
