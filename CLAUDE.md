# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Task Goblin is a local web app + Bun server that aggregates tasks from Jira, GitHub, and manual entries. Provides a unified dashboard to manage tasks. Exposes task data and write operations via MCP for AI agent integration.

Single-user, local only. No auth. Credentials stored in `.env`.

## Tech Stack

- **Runtime:** Bun (`Bun.serve()` for backend, first-class SQLite support)
- **Frontend:** React with React Router v7
- **Styling:** shadcn/ui + Tailwind CSS
- **Database:** SQLite with drizzle-orm
- **APIs:** jira.js, @octokit/rest
- **Testing:** Vitest

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server
bun run build        # Build for production
bun test             # Run all tests
bun test <file>      # Run single test file
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
/prompts          ← shared prompt templates
/plans            ← task plan files (markdown, gitignored except .gitkeep)
/src/server       ← Bun API backend
/src/client       ← React frontend
/src/db           ← SQLite schema and queries (drizzle-orm)
/src/shared       ← shared types/utilities
```

### API Pattern
All endpoints: `/api/v1/*`. Timestamps use ISO 8601 format throughout DB and API.

### Key Models
- **Task** - workflow-level task with status, notes, planFile
- **Branch** - git branch linked to Task; may have associated PullRequest
- **BlockedBy** - polymorphic junction: tasks can be blocked by other tasks or todos
- **Todo** - checklist items with optional parent Task
- **Repository** - configured GitHub repos (credentials in `.env`)

### MCP Server
Standalone process providing programmatic access for AI agents. Consumes REST API. Can: list/read tasks, append notes, manage todos, update plan files.
