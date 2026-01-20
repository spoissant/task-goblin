# Task Goblin

A personal task aggregator that pulls your Jira issues and GitHub PRs into a unified dashboard.

Single-user, local-only. No authentication required—just run it on your machine.

## Quick Start

```bash
bun install          # Install dependencies
bun run dev          # Start all dev servers
```

The API runs on `http://localhost:3456` and the frontend on `http://localhost:5173`.

## Initial Setup

### Step 1: Environment Variables

Create a `.env` file in the project root:

```bash
JIRA_API_TOKEN=your-jira-api-token
GITHUB_TOKEN=your-github-personal-access-token
```

**Getting tokens:**
- **Jira:** Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens
- **GitHub:** Create a PAT at https://github.com/settings/tokens (needs `repo` scope)

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
[Frontend Web App] ──→ [Bun API Backend]
                            ↓
                      [SQLite Database]
                            ↓
                   [Jira/GitHub APIs]
```
