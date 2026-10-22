---
name: chore-validate-issue
description: Confirm a bug before work starts, read-only — duplicates, merged fixes, code, Datadog logs and a staging repro in Chrome, then a verdict. Use for /chore-validate-issue <taskId>, "validate this bug", "can you reproduce this", or "is this issue real".
allowed-tools: "ToolSearch,AskUserQuestion,Agent,Bash(git:*),Bash(gh:*),Read,Grep,Glob,mcp__task-goblin__get_task,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__searchJiraIssuesUsingJql,mcp__plugin_hivebrite-engineering_datadog__search_datadog_logs,mcp__plugin_hivebrite-engineering_datadog__analyze_datadog_logs,mcp__claude-in-chrome__*"
---

# Validate Issue

Numeric task ID (ask if missing). This runs before work starts, so there is no worktree and no branch. The session sits in the repository's main checkout, which the dev stack may have detached at another task's branch. Read code only through git objects on `origin/<base>` (alumni_connect: `sprint`, front-monorepo: `main`): `git fetch origin <base>`, then `git grep`, `git show origin/<base>:<path>` and `git log origin/<base>`. Never check out, commit or edit files, and change nothing in Jira or Task Goblin. The verdict lives in this session only.

Load the MCP tools this skill uses with one `ToolSearch` `select:` query naming them exactly.

## 1. The claim

`get_task(id)` → `jiraKey`, `title`, `repository`. `getAccessibleAtlassianResources` for the cloud id, then `getJiraIssue` with `responseContentFormat: "markdown"`: description, steps to reproduce, expected versus actual, where it was seen (network, role, device, browser, production or staging), linked tickets and comments. Without a Jira key, work from the task's title and description.

Restate the claim in a few lines: who does what, where, what happens, what should happen instead.

## 2. Already known?

Search by symptom, not by key: `searchJiraIssuesUsingJql` on the symptom's keywords (`text ~ "…"`, resolved tickets from the last 180 days included), `gh pr list --state all --search "<keywords>"` for fixes in flight or merged, and `git log origin/<base> --grep=<keyword>` or `-- <suspected path>` for commits that already touched it. A merged fix or an open duplicate is a lead for step 4, not a verdict yet.

## 3. Code and logs

Delegate the code reading to `Explore` agents with `model: "sonnet"`, launched in one message, one per independent area (backend and frontend, or each suspected code path). Each brief carries the claim and the ref to read (`origin/<base>`, through `git grep` and `git show` only, since the working tree is on another branch). Each agent returns about 40 lines: the relevant `file:line` locations, the current behaviour, whether that code can produce the reported symptom, and the commits that last changed it.

When the report carries an error, a 5xx, a network or a time, `search_datadog_logs` around it (`analyze_datadog_logs` for counts), filtered by service, network id and error text. No logs is not evidence that it is fixed.

## 4. Reproduce on staging

Follow `references/staging.md`: pick the env, check what it runs beyond `<base>`, write the reproduction steps, and have Haiku subagents run them in Chrome while this session keeps the verdict. When the issue cannot be reached through a browser (a background job, email content, a third-party integration, data that only exists in production), say so and rely on steps 2 and 3.

## 5. Verdict

Print a banner (`🔎 Validate · <jiraKey> · <verdict>`) and the evidence behind it. One verdict:

- **Confirmed**: reproduced on staging. Give the exact steps (env, URL, role), what was seen versus expected, and the likely cause at `file:line` on `origin/<base>`.
- **Already fixed**: not reproduced, and a merged commit or PR explains why. Name it and when it merged.
- **Duplicate**: another ticket or an open PR covers it. Name it and its state.
- **Works as designed**: the code does what it was built to do and the ticket expects something else. Quote the code or doc that shows it.
- **Not reproduced**: the steps were followed and nothing in the code or the logs explains the report. List what was tried and what differed from the report (data, flag, role, browser), so the reporter can be asked.
- **Needs info**: the ticket lacks what reproduction needs. List the questions for the reporter.

Keep the uncertainty. A code path that could cause the symptom but was not reproduced is Not reproduced with that hypothesis, not Confirmed. Stop there: the fix is `/chore-start-task`'s job.
