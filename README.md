# task-goblin

View and manage your Jira issues, link them to GitHub PRs, and leverage the task goblin to get things done faster!

## Quick Start

```bash
bun install          # Install dependencies
bun run dev          # Start all dev servers
```

The API runs on `http://localhost:3456` and the frontend on `http://localhost:5173`.

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Required for Jira sync
JIRA_API_TOKEN=your-jira-api-token

# Required for GitHub sync
GITHUB_TOKEN=your-github-personal-access-token

# Optional
PORT=3456                    # API server port (default: 3456)
DATABASE_URL=task-goblin.db  # SQLite file path (default: task-goblin.db)
```

**Getting tokens:**
- Jira: Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens
- GitHub: Create a PAT at https://github.com/settings/tokens (needs `repo` scope)

### Settings (Database)

Configure via API (`POST /api/v1/settings`) or future settings UI:

| Key | Description | Example |
|-----|-------------|---------|
| `jira_host` | Jira Cloud host | `your-org.atlassian.net` |
| `jira_email` | Your Jira email (for API auth) | `you@company.com` |
| `jira_project` | Default project key | `PROJ` |
| `jira_jql` | JQL query for syncing issues | `assignee = currentUser()` |
| `github_username` | GitHub username for PR search | `yourusername` |

### Repository Configuration

GitHub repositories are configured via the `repositories` table/API:

```bash
# Add a repository to sync PRs from
curl -X POST http://localhost:3456/api/v1/repositories \
  -H "Content-Type: application/json" \
  -d '{"owner": "your-org", "repo": "your-repo", "enabled": true}'
```

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start all dev servers (API + frontend)
bun run dev:api      # Start API server only (port 3456)
bun run dev:web      # Start frontend only
bun run build        # Build for production
bun test             # Run all tests
bun test <file>      # Run single test file
```

## Syncing Data

```bash
# Sync all Jira issues matching your JQL
curl -X POST http://localhost:3456/api/v1/refresh/jira

# Sync a specific Jira issue
curl -X POST http://localhost:3456/api/v1/refresh/jira/PROJ-123

# Sync all PRs from configured repositories
curl -X POST http://localhost:3456/api/v1/refresh/github

# Sync a specific PR
curl -X POST http://localhost:3456/api/v1/refresh/github/owner/repo/42
```

## Architecture

```
[Frontend Web App] --> [Bun API Backend] <-- [MCP Server]
                            |
                      [SQLite Database]
                            |
                   [Jira/GitHub APIs]
```

See `/plans/task-goblin.md` for detailed architecture and API documentation.
