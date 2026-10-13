---
name: chore-assign-jira-ticket
description: Create a Jira ticket for a PR that has none — checks out the branch, runs jira-create-ticket, records the key on the task, and updates the PR title. Use for /chore-assign-jira-ticket <taskId>.
allowed-tools: "ToolSearch,Bash(git:*),Bash(gh:*),Skill(checkout-branch),Skill(hivebrite-engineering:jira-create-ticket),mcp__task-goblin__get_task,mcp__task-goblin__update_task,mcp__task-goblin__sync_task"
---

# Assign Jira Ticket

Numeric task ID argument (ask if missing). `get_task(id)` → `headBranch`, `prNumber`, `repository` (owner/repo).

1. `Skill(checkout-branch)` with `headBranch`; if it fails, stop and tell the user.
2. `Skill(hivebrite-engineering:jira-create-ticket)` and capture the new key.
3. `update_task(id, jiraKey: <key>)`.
4. Read the PR title with `gh pr view <pr> --repo <owner/repo> --json title --jq .title`, strip deprecated `[TT-\d+]` and `[skip-commit-lint]` tags, append ` [<key>]`, and set it with `gh pr edit --title`.
5. `sync_task(id)` so task-goblin pulls the new ticket.
