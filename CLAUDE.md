# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Task Goblin is a local web app + Bun server that aggregates tasks from Jira, GitHub, and manual entries. Provides a unified dashboard to manage tasks. Exposes task data and write operations via MCP for AI agent integration.

Single-user, local only. No auth. Credentials stored in `.env`.

## Tech Stack

- **Runtime:** Bun (`Bun.serve()` for backend, native SQLite)
- **Frontend:** React 19 + React Router v7 + TanStack Query
- **Styling:** shadcn/ui + Tailwind CSS + Radix UI
- **Database:** SQLite with drizzle-orm
- **APIs:** jira.js, @octokit/rest
- **MCP:** @modelcontextprotocol/sdk
- **Testing:** Bun native test runner

## Commands

```bash
bun install           # Install dependencies
bun run dev           # Start all dev servers
bun run dev:api       # API server (port 3456)
bun run dev:web       # Frontend (port 5173)
bun run dev:kill      # Kill dev servers
bun run build         # Build for production
bun test              # Run tests
bun run db:generate   # Generate drizzle schema
bun run db:migrate    # Run migrations (unreliable — see DB Migrations below)
bun run mcp           # Launch MCP server
```

## Architecture

```
[Frontend Web App] ──→ [Bun API Backend] ←── [MCP Server]
                            ↓
                      [SQLite Database]
                            ↓
                   [Jira/GitHub APIs]
```

### Folder Structure
```
/prompts              ← shared prompt templates
/plans                ← task plan files (gitignored)
/drizzle              ← database migrations
/src/server           ← Bun API backend
  /routes             ← route handlers
  /services           ← sync, deploy, merge logic
  /lib                ← clients, errors, validation, utilities
  router.ts           ← pattern-matching router
  middleware.ts       ← CORS, error boundary
  response.ts         ← json(), created(), noContent(), error()
/src/client           ← React frontend
/src/db               ← SQLite schema, relations, db client
/src/mcp              ← MCP server + tools
/src/test             ← test utilities
/src/shared           ← shared types/utilities
```

### API Pattern
All endpoints: `/api/v1/*`. Default port: 3456. Timestamps use ISO 8601 format throughout DB and API.

Response formats:
- Success: `{ ...resource }` or `{ items: [], total: N }`
- Error: `{ error: { code, message } }`

### Environment Variables
- `PORT` - API port (default: 3456)
- `DATABASE_URL` - SQLite path (default: task-goblin.db)
- `JIRA_API_TOKEN` - Jira API auth
- `GITHUB_TOKEN` - GitHub API auth
- `API_URL` - MCP client base URL (default: localhost:3456)

### Key Models
- **Task** - unified task (manual, Jira, PR) with status, notes, instructions
- **Todo** - checklist items with ordering
- **Repository** - GitHub repo config
- **Logs** - activity audit trail with read/unread
- **StatusCategories** - configurable status workflow states
- **TaskFilters** - filter bar configuration
- **Settings** - key-value config store

### DB Migrations
`drizzle-kit migrate` can silently fail to apply migrations to the actual DB file. After generating and running a migration:
1. **Always verify** the column/table exists: `sqlite3 task-goblin.db "PRAGMA table_info(<table>);"`
2. If missing, **apply the SQL manually**: `sqlite3 task-goblin.db < drizzle/<migration>.sql`

### MCP Server
Standalone process providing programmatic access for AI agents. Consumes REST API. Can: list/read tasks, append notes, manage todos, update plan files.
