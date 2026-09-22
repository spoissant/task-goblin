-- Custom-prompt sessions pick a model and effort level
ALTER TABLE claude_sessions ADD COLUMN model TEXT;
ALTER TABLE claude_sessions ADD COLUMN effort TEXT;
