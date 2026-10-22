#!/usr/bin/env bash
# Writes hivebrite_settings.sql: the Settings-page data a Hivebrite teammate can
# reuse (Jira host, statuses, repositories, team channels...). Personal values
# (email, GitHub username, JQL, members, squad Slack channels) are left out.
# The file is gitignored because this repo is public: share it directly.
#
# Usage: scripts/export-hivebrite-settings.sh [db] [out]
set -euo pipefail

DB="${1:-${DATABASE_URL:-task-goblin.db}}"
OUT="${2:-hivebrite_settings.sql}"

dump() { # <table> <select>
  sqlite3 -cmd ".headers on" -cmd ".mode insert $1" "$DB" "$2" | sed 's/^INSERT INTO/INSERT OR REPLACE INTO/'
}

{
  echo "-- Task Goblin shared Hivebrite settings, exported $(date -u +%Y-%m-%dT%H:%M:%SZ)."
  echo "-- Load into a freshly migrated DB: sqlite3 task-goblin.db < $OUT"
  echo "BEGIN;"
  dump settings "SELECT key, value FROM settings
    WHERE key IN ('jira_host', 'jira_sprint_field', 'chore_models', 'ignored_members', 'status_default_color')"
  echo "DELETE FROM status_categories;"
  dump status_categories "SELECT * FROM status_categories ORDER BY display_order"
  echo "DELETE FROM team_channels;"
  dump team_channels "SELECT * FROM team_channels ORDER BY id"
  dump repositories "SELECT id, owner, repo, alias, local_path, enabled, badge_color, deployment_branches, deployment_urls,
    CASE WHEN slack_channel LIKE '#squad-%' THEN NULL ELSE slack_channel END AS slack_channel,
    setup_command, teardown_command, default_base_branch
    FROM repositories ORDER BY id"
  echo "COMMIT;"
} > "$OUT"

echo "Wrote $OUT"
