---
name: chore-prep-dev-qa
description: Prepare the dev QA video of a deployed alumni_connect task — check the test env runs the PR, create the demo data there, and print the script the user records from. Use for /chore-prep-dev-qa <taskId>, "prep my dev QA", or "set up the demo for QA".
allowed-tools: "ToolSearch,AskUserQuestion,Bash(git:*),Bash(gh:*),Read,Grep,Glob,mcp__task-goblin__get_task,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_launchdarkly__get-flag,mcp__plugin_hivebrite-engineering_launchdarkly__get-flag-status-across-envs,mcp__claude_ai_Hivebrite_MCP_Admin_Staging__*,mcp__claude_ai_Hivebrite_Admin_Mcp_barney_env__*,mcp__claude-in-chrome__*"
---

# Prep Dev QA

Numeric task ID (ask if missing). The user records a short video on the test env that shows the fix or the feature, as the reference for QA. This chore removes the ramp-up: it recalls what the task is about, makes the env ready to demo, and hands over a script. The user records; this session never records, never changes code, Jira or the PR.

Load the MCP tools this skill uses with one `ToolSearch` `select:` query naming them exactly.

## 1. What to show

`get_task(id)` → `jiraKey`, `prNumber`, `headBranch`, `onDeploymentBranches`. `getJiraIssue` (`responseContentFormat: "markdown"`) for the description, acceptance criteria and, for a bug, the steps to reproduce. `gh pr view <pr> --json title,body,headRefOid` and `gh pr diff <pr>` for the screens, roles, flags and data the change touches. Note any LaunchDarkly flag the diff checks.

Restate in a few lines what QA must see: the flow, the role, and for a bug the broken behaviour the fix removes.

## 2. The env

Use `staging` when it is in `onDeploymentBranches`, `barney` when it is the only one or the ticket needs real mobile devices. Not deployed: stop and say so. `git fetch origin <env>` and `git merge-base --is-ancestor <headRefOid> origin/<env>`: not an ancestor means the env runs an older commit, so stop and suggest redeploying. Check the env build is green (`https://buildkite.com/hivebrite/alumni-connect/builds?branch=<env>`, through `gh` or ask); a running build is worth saying, not blocking.

A flag the change sits behind: `get-flag-status-across-envs` for the env. Off for the demo network is a blocker the user decides on (ask; flags on shared envs are not this session's to toggle).

## 3. Set the env up

Follow `references/setup.md`: the demo network, the data through the env's Hivebrite Admin MCP, Chrome only for what the API cannot do, and the shared-env rules.

## 4. The script

Print a banner (`🎬 Dev QA · <jiraKey> · <env>`), then:

- **Recap**: two or three lines on what changed and why, to read before hitting record.
- **Before you record**: the role and account to be signed in as (front office or back office URL), the window width when it matters, anything the user must check first.
- **Script**: numbered steps, each with the exact URL or the click path, what to do, and what to point at on camera. Deep links to the content created in step 3. A bug: say what the screen looked like before the fix, since the env now runs it. Keep it to what QA needs; one flow, a minute or two of video.
- **Created on <env>**: what was created, with links, so it can be reused or removed later.
- **Not covered**: anything the script cannot demo (emails, background jobs, touch-only) and how QA can check it instead.
