# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Task Goblin is a local web app + Bun server that aggregates tasks from Jira, GitHub, and manual entries into one dashboard, and exposes task data and write operations over MCP for AI agents.

Single-user, local only. No auth. Credentials stored in `.env`.

## API Pattern
All endpoints: `/api/v1/*`. Default port: 3456. Timestamps use ISO 8601 format throughout DB and API.

Response formats:
- Success: `{ ...resource }` or `{ items: [], total: N }`
- Error: `{ error: { code, message } }`

## DB Migrations
No drizzle-kit migrations. Change `src/db/schema.ts`, hand-write the next `drizzle/NNNN_<name>.sql`, apply it with `sqlite3 task-goblin.db < drizzle/NNNN_<name>.sql`, then verify with `sqlite3 task-goblin.db "PRAGMA table_info(<table>);"`. Fresh DBs use `bun run db:push` (builds from `schema.ts`).

## MCP Server
Standalone process (`bun run mcp`) providing programmatic access for AI agents. Consumes the REST API.

## Skills
The chore skills live in `skills/` and are symlinked into `~/.claude/skills/` by `scripts/link-skills.sh` (sessions run in other repos, so they must be user-level). Editing `~/.claude/skills/<chore>` edits this repo: commit the change here. `hivebrite_settings.sql` (from `scripts/export-hivebrite-settings.sh`) is gitignored because the repo is public.
