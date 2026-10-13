# Task Goblin

A personal task aggregator that pulls your Jira issues and GitHub PRs into a unified dashboard.

Single-user, local-only. No authentication required—just run it on your machine.

## Quick Start

```bash
bun install          # Install dependencies
bun run db:push      # Create the SQLite schema (first run)
bun run dev          # Start all dev servers
```

The API runs on `http://localhost:3456` and the frontend on `http://localhost:5173`.

On a fresh DB use `db:push`, not `db:migrate`: the migration journal does not cover every file in `drizzle/` (several were applied by hand), so `push` builds the schema straight from `src/db/schema.ts`. Check with `sqlite3 task-goblin.db .tables`.

## Setting Up at Hivebrite

The chores (start task, AI QA, self review, deploy, reviews...) run Claude Code skills against your local alumni_connect and front-monorepo checkouts. Beyond the Quick Start you need:

**Tools**
- [Bun](https://bun.sh), Docker, and the `gh` CLI logged in (`gh auth login`)
- A recent `claude` CLI logged into claude.ai (background sessions use `claude --bg --rc`, `claude agents`, `claude stop`)
- The `hivebrite-engineering` Claude Code plugin (Atlassian and Buildkite MCPs, `github-commit`, `github-pr`, `request-pr-review`, `staging-deploy`). In Claude Code:
  ```
  /plugin marketplace add git@github.com:Hivebrite/claude-code-plugins
  /plugin install hivebrite-engineering@hivebrite-claude-plugins
  ```
- The Claude in Chrome extension (used by `/chore-ai-qa`)
- Optional: `lavish-axi` on your `PATH` for browser review of plans and findings (skills fall back to the terminal without it)
- npm publish rights on `@hivebrite/*` if you publish front-monorepo alphas

**Checkouts** live under `~/Code/hivebrite/`: `alumni_connect/alumni_connect`, `front-monorepo`, and any other repo you track. The shared settings and some skills assume this layout; if yours differs, fix the paths on the Settings page. The dev stack only supports alumni_connect and front-monorepo (hardcoded in `src/server/services/dev-stack.ts`).

Task Goblin itself can be cloned anywhere; only the MCP registration points at its path.

**Steps**
1. Create `.env` with both tokens (see [Getting tokens](#step-1-environment-variables)).
2. `bun install && bun run db:push`
3. Load the shared settings: ask a teammate for `hivebrite_settings.sql` (kept out of this public repo), then `sqlite3 task-goblin.db < hivebrite_settings.sql`. It holds the Jira host and sprint field, status mappings, the 9 Hivebrite repositories with their checkout paths, GitHub team → Slack channels and chore models.
4. On the Settings page, fill in what's personal: Jira email and JQL, GitHub username, team members, and your squad's Slack channel on alumni_connect.
5. Register the MCP server (use your clone path): `claude mcp add task-goblin -s user -- bun run ~/Code/task-goblin/src/mcp/index.ts`
6. `scripts/link-skills.sh` symlinks the chore skills from `skills/` into `~/.claude/skills/`. A `git pull` then updates them; rerun the script when a skill is added.

To refresh the shared file from your own DB: `scripts/export-hivebrite-settings.sh` (writes the gitignored `hivebrite_settings.sql`; personal values and squad channels are left out).

If `db:push` fails with `NODE_MODULE_VERSION` / `ERR_DLOPEN_FAILED`, `better-sqlite3` was built for another Node version: run `npm rebuild better-sqlite3`.

## Initial Setup

### Step 1: Environment Variables

Create a `.env` file in the project root:

```bash
JIRA_API_TOKEN=your-jira-api-token
GITHUB_TOKEN=your-github-personal-access-token
```

**Getting tokens.** Task Goblin only reads from Jira and GitHub; writes go through the skills and `gh`.

- **GitHub** needs the `repo` and `read:org` scopes (PR search, files, checks, reviews, your teams). Easiest is to reuse the token `gh` already holds:
  ```bash
  echo "GITHUB_TOKEN=$(gh auth token)" >> .env
  ```
  Or create one at https://github.com/settings/tokens → **Generate new token (classic)**, tick `repo` and `read:org`. If GitHub shows **Configure SSO** next to it, authorize your org, or its repos won't sync.
- **Jira:** at https://id.atlassian.com/manage-profile/security/api-tokens click **Create API token** (*not* "Create API token with scopes": scoped tokens need a different API URL and fail here). Name it, pick an expiry (1 year max), then `echo "JIRA_API_TOKEN=<token>" >> .env`. It pairs with the Jira email set on the Settings page. When it expires, Jira sync fails with an auth error: create a new one and replace it in `.env`.

### Step 2: Configure Jira

In the Settings page, configure:

| Setting | Description | Example |
|---------|-------------|---------|
| Host URL | Your Jira Cloud host | `your-org.atlassian.net` |
| Email | Your Jira email (for API auth) | `you@company.com` |
| Project Key | Default project to sync | `PROJ` |
| JQL (optional) | Custom query for syncing | `assignee = currentUser()` |
| Sprint Field (optional) | Custom field ID for sprint data | `customfield_10020` |

### Step 3: Configure GitHub

In the Settings page, set your GitHub username. This is used to find PRs you've authored.

### Step 4: Add Repositories

In the Settings page, add the GitHub repositories you want to sync PRs from.

For each repository you can optionally configure:
- **Badge color** — customize how it appears in the dashboard
- **Deployment branches** — branches to track for deployment status

## Curate Process

Task Goblin's main workflow is **curating** tasks—linking your Jira issues to their corresponding GitHub PRs.

1. **Sync All** — Click the sync button to pull latest Jira issues and GitHub PRs
2. **Auto-match** — Task Goblin suggests matches based on Jira keys found in branch names (e.g., `feature/PROJ-123-add-login` matches `PROJ-123`)
3. **Accept** — Review suggested matches in the modal and confirm correct ones
4. **Manual merge** — Drag a Jira card onto a PR card (or vice versa) to link them manually
5. **Split** — If you linked the wrong items, split them apart and try again

Once linked, tasks show combined status from both Jira and GitHub in one place.

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

## Architecture

```
[Frontend Web App] ──→ [Bun API Backend] ←── [MCP Server]
                            ↓
                      [SQLite Database]
                            ↓
                   [Jira/GitHub APIs]
```

## MCP Server

Task Goblin exposes an MCP server for AI agent integration. The server provides tools including:

| Tool | Description |
|------|-------------|
| `get_task` | Get a single task by ID or Jira key (returns task with its repository) |
| `update_task` | Update task fields: title, description, status, repository (only while the task has no PR), choreSkips, workingOn |
| `delete_task` | Permanently delete a task (and tear down its worktree) |
| `list_team_channels` | List GitHub team → Slack channel mappings for review requests |
| `get_pr_changes_by_category` | Get a PR's size and frontend/backend/other file split |
| `list_sessions` | List AI sessions across all tasks, optionally only those active since a timestamp |

### Setup

Add to your Claude Code MCP config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "task-goblin": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/task-goblin"
    }
  }
}
```

The MCP server requires the API server to be running (`bun run dev:api`).

## Standup Summaries

Hit **Generate** on the **Standup** page before the meeting. The server runs the
`standup` skill headless (`claude -p /standup`, Sonnet, about a minute and
$0.30) and renders its Markdown, with Jira keys linked and a Copy button for
Slack. Recent runs stay in a dropdown. The skill reads the AI sessions that were
active since the previous workday's 10:00 standup (`list_sessions` with
`since`), groups their results per task, and adds the live board state for what
is waiting on someone else. `/standup` also works straight from Claude Code.
Sessions you start by hand outside Task Goblin are not tracked, so mention those
yourself.
