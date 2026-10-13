---
name: chore-continue-work
description: Resume a task QA sent back — reads the QA feedback from Jira, proposes an actionable fix plan, implements it after approval, self-reviews only the new commits, pushes, and moves the ticket back to Code Review. Use for /chore-continue-work <taskId>, "continue working on task", or "QA bounced this task".
allowed-tools: "ToolSearch,AskUserQuestion,Bash(git:*),Bash(gh:*),Bash(lavish-axi:*),Read,Grep,Glob,Write,Edit,Skill(checkout-branch),Skill(hivebrite-engineering:github-commit),mcp__task-goblin__get_task,mcp__task-goblin__sync_task,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__executeRead,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__claude_ai_Atlassian__getTransitionsForJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__transitionJiraIssue,Skill(hivebrite-engineering:jira-postmortem-bug)"
---

# Continue After QA

Numeric task ID argument (ask if missing). The PR already went through AI QA and self-review; QA found issues and moved the ticket back to In Progress. Fixes are usually small, so this loop stays cheap: no Chrome retest, no full-PR review.

## 1. Context

`get_task(id)` → `title`, `jiraKey`, `prNumber`, `headBranch`, `baseBranch`. `Skill(checkout-branch)` with `headBranch`; if it fails, stop and tell the user. Then `git pull origin <headBranch>` and note `PRE_FIX=$(git rev-parse HEAD)`.

## 2. QA feedback

Jira comments newer than the last commit (`git log -1 --format=%aI`): `getAccessibleAtlassianResources` for the cloud id, then `executeRead` with `name: "listJiraIssueComments"`, `inputs: { issueIdOrKey, orderBy: "-created", maxResults: 20 }` and `cloudId` top-level, filtered by `created` (`getJiraIssue` only counts comments). Keep comments that report a problem, a request, or a blocker. If there are none, ask the user to paste the QA feedback.

Unresolved PR comments are not this skill's job (`/chore-address-pr-comments` handles them).

## 3. Plan

Investigate each QA issue in the code (the PR diff `gh pr diff <pr>` and the files it touches) and write one numbered item per issue: what QA saw, the cause with `file:line`, the fix, and the spec that covers it. Mark items you could not reproduce from the code or that need a product decision with ❓ and say what you need.

Present the plan and get approval: a Lavish artifact at `.lavish/qa-plan-<taskId>.html` if `lavish-axi` is installed (open it, `lavish-axi poll` in the background; annotations on an item are directives for it), otherwise a single AskUserQuestion. The user replies with exceptions ("2: skip", "3: do X instead") or "go".

## 4. Fix

Implement the approved items and run the specs for the touched files.

## 5. Delta review

Review only `git diff $PRE_FIX` (commits and working tree) against `~/.claude/skills/chore-code-review-pr/references/checklist.md`. Fix CRITICAL and WARNING findings directly and list them; ignore SUGGESTIONs.

If the delta exceeds roughly 150 changed lines, say a full `/chore-ai-qa` and `/chore-code-review-my-pr` are worth running by hand, and carry on.

## 6. Wrap up

Commit with `Skill(hivebrite-engineering:github-commit)` and `git push`. If the ticket is a Bug and Tech root cause (`customfield_11150`), Process root cause (`customfield_12217`) or Preventive measures (`customfield_12218`) is empty, run `Skill(hivebrite-engineering:jira-postmortem-bug)` on it first. Move the Jira ticket to Code Review: skip if it is already there or beyond; otherwise pick the transition whose target is "Code Review" from `getTransitionsForJiraIssue` (claude.ai Atlassian connector; the plugin server lacks it) and apply it with `transitionJiraIssue`. If no such transition exists, show the available ones and ask. Then `sync_task(id)`.

Print each QA item with its outcome (fixed in `<sha>`, skipped, ❓ open). Remind the user the fix needs redeploying before moving the ticket to Ready for QA.

Lavish: use the globally installed `lavish-axi` binary, never `npx -y`; only open HTML you generated; keep `.lavish/` in `.git/info/exclude`; `lavish-axi end` when done.
