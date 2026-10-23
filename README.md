# Task Goblin

A personal task aggregator that pulls your Jira issues and GitHub PRs into a unified dashboard, and runs Claude Code sessions (chores) on them.

Single-user, local-only. No authentication required—just run it on your machine.

## Quick Start

```bash
bun install          # Install dependencies
bun run db:push      # Create the SQLite schema (first run)
bun run dev          # Start all dev servers
```

The API runs on `http://localhost:3456` and the frontend on `http://localhost:5173`.

`db:push` builds a fresh DB straight from `src/db/schema.ts`; check it with `sqlite3 task-goblin.db .tables`. Schema changes ship as hand-written `drizzle/NNNN_*.sql` files: when a pull brings a new one, apply it to your DB with `sqlite3 task-goblin.db < drizzle/<file>.sql`.

## Setting Up at Hivebrite

The chores (start task, AI QA, self review, deploy, reviews...) run Claude Code skills against your local alumni_connect and front-monorepo checkouts. Beyond the Quick Start you need:

**Tools**
- [Bun](https://bun.sh), Docker, and the `gh` CLI logged in (`gh auth login`)
- A recent `claude` CLI logged into claude.ai (background sessions use `claude --bg --rc`, `claude agents`, `claude stop`)
- The `hivebrite-engineering` Claude Code plugin (its Atlassian, Buildkite and Datadog MCPs, and skills such as `jira-fix-bug`, `github-commit`, `github-pr`, `request-pr-review`, `staging-deploy`, `update-internal-sdks`). In Claude Code:
  ```
  /plugin marketplace add git@github.com:Hivebrite/claude-code-plugins
  /plugin install hivebrite-engineering@hivebrite-claude-plugins
  ```
- The Claude in Chrome extension (used by `/chore-ai-qa` and `/chore-validate-issue`)
- Optional: `lavish-axi` on your `PATH` for browser review of plans and findings (skills fall back to the terminal without it)
- npm publish rights on `@hivebrite/*` if you publish front-monorepo alphas

**Checkouts** live under `~/Code/hivebrite/`: `alumni_connect/alumni_connect`, `front-monorepo`, and any other repo you track. The shared settings and some skills assume this layout; if yours differs, fix the paths on the Settings page. The dev stack only supports alumni_connect and front-monorepo (hardcoded in `src/server/services/dev-stack.ts`).

Task Goblin itself can be cloned anywhere; only the MCP registration points at its path.

**Steps**
1. Create `.env` with both tokens (see [Getting tokens](#step-1-environment-variables)).
2. `bun install && bun run db:push`
3. Load the shared settings: ask a teammate for `hivebrite_settings.sql` (kept out of this public repo), then `sqlite3 task-goblin.db < hivebrite_settings.sql`. It holds the Jira host and sprint field, status mappings, the 9 Hivebrite repositories with their checkout paths, GitHub team → Slack channels, ignored authors and chore models.
4. On the Settings page, fill in what's personal: Jira email and JQL, GitHub username, team members and VIPs, and your squad's Slack channel on alumni_connect.
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

**Getting tokens.** Task Goblin mostly reads from Jira and GitHub. Its own writes are the Merge button's squash merge, approving front-monorepo release PRs after a merge, and moving merged tickets to Ready to Prod; everything else goes through the skills and `gh`.

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
| Jira Host | Your Jira Cloud host | `https://your-org.atlassian.net` |
| Jira Email | Your Jira email (for API auth) | `you@company.com` |
| Custom JQL (optional) | Which issues sync; the default is your open, non-epic issues | `assignee = currentUser()` |
| Sprint Field ID | Custom field holding the sprint (default `customfield_10003`) | `customfield_10020` |

### Step 3: Configure GitHub

In the Settings page, set your GitHub username. It decides whose PRs sync as tasks and whose review requests the Reviews page lists.

### Step 4: Add Repositories

In the Settings page, add the GitHub repositories you want to sync PRs from. For each one you can set:
- **Alias** — a short name shown on its badge, also accepted by `update_task`'s `repository`
- **Badge color** — how it appears in the dashboard
- **Local checkout path** — its main checkout on this machine, which task worktrees, AI sessions and the dev stack need
- **Deployment branches** — branches to track for deployment status, each with its environment URL
- **Slack channel** — where review requests for its PRs go
- **Task worktrees** — the default base branch for tasks without a branch, and the setup and teardown commands run in each task worktree

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start all dev servers (API + frontend)
bun run dev:api      # Start API server only (port 3456)
bun run dev:web      # Start frontend only
bun run build        # Bundle the frontend into dist/ (a build check; nothing serves it)
bun test             # Run all tests
bun test <file>      # Run single test file
```

## Architecture

```
[Frontend Web App] ──→ [Bun API Backend] ←── [MCP Server] ←── [Claude Code sessions]
                              │
           ┌──────────────────┼───────────────────┐
           ↓                  ↓                   ↓
   [SQLite Database]  [Jira/GitHub APIs]  [claude CLI: starts the sessions]
```

## MCP Server

Task Goblin exposes an MCP server for AI agents; the chore skills call it. It goes through the REST API, so the API server must be running (`bun run dev` or `bun run dev:api`). Register it as in step 5 of [Setting Up at Hivebrite](#setting-up-at-hivebrite).

| Tool | Description |
|------|-------------|
| `get_task` | Get a task by ID, Jira key, PR number or branch, with its repository |
| `create_task` | Import a GitHub PR as a task (e.g. a colleague's PR the sync doesn't pull) |
| `list_tasks` | List tasks, paginated, filtered by status, title or key search, checks, unresolved comments, or completed |
| `update_task` | Update a task's title, description, status (not for Jira tasks), repository (only while it has no PR) or chore skips |
| `delete_task` | Permanently delete a task and tear down its worktree |
| `sync` | Run a full sync pass now: Jira, GitHub, git statuses, then merge watch, Ready to Prod, merge gate and chore scheduler |
| `sync_task` | Re-pull one task's Jira issue, PR (linking the PR opened from its branch) and git status |
| `prepare_task_worktree` | Create or reuse a task's git worktree and wait for its setup command |
| `chore_definitions` | List the chores with their keys, conditions, prompt templates and bulk/auto flags |
| `start_session` | Start a background Claude Code session on a task, for a chore or a custom prompt |
| `list_sessions` | List AI sessions across all tasks, optionally only those active since a timestamp |
| `list_task_sessions` | List one task's AI sessions with their state and Remote Control link |
| `dev_stack_status` | Get the dev stack of a task's repository, optionally waiting for it to settle |
| `start_dev_stack` | Boot a task's branch, optionally merged with other tasks' branches, as the local dev stack |
| `refresh_dev_stack` | Move the running stack to the branch's latest commit without restarting it |
| `dev_stack_login_link` | Mint a one-time sign-in link into the running alumni_connect stack |
| `stop_dev_stack` | Stop the stack and switch the main checkout back to its base branch |
| `list_team_channels` | List the GitHub team → Slack channel mappings for review requests |

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
