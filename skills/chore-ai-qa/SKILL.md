---
name: chore-ai-qa
description: QA a task's PR in Chrome against the local dev stack — boots or reuses the stack, derives a test plan from the Jira ticket and PR, runs it with the Claude in Chrome extension, then stops the stack and moves the Jira ticket to Code Review when everything passed (the PR stays a draft until /chore-code-review-my-pr), or leaves the stack up and asks a human to validate what it could not. Several task IDs QA their PRs merged on one stack, one task after another. Use for /chore-ai-qa <taskId> [<taskId>…] or "AI QA this task / these tasks".
allowed-tools: "ToolSearch,AskUserQuestion,Agent,Bash(gh:*),Bash(git:*),Read,Grep,Glob,mcp__task-goblin__get_task,mcp__task-goblin__sync_task,mcp__task-goblin__dev_stack_status,mcp__task-goblin__start_dev_stack,mcp__task-goblin__refresh_dev_stack,mcp__task-goblin__stop_dev_stack,mcp__task-goblin__dev_stack_login_link,mcp__claude-in-chrome__*,mcp__playground__*,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__claude_ai_Atlassian__getTransitionsForJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__transitionJiraIssue,Skill(hivebrite-engineering:jira-postmortem-bug)"
---

# AI QA

One or more numeric task IDs (ask if missing). Several IDs: follow `references/batch.md` instead of the steps below. Read-only on code: QA reports problems, it never fixes them. The local stack is disposable, so local state is not code: seed data, post, upload and save through the UI, toggle flags in the main checkout's gitignored `launchdarkly.dev.yml` (restore them afterwards), and repair the local environment (step 2).

`--stack-ready` (set by the batch run): the stack is already up with this task in it. Step 2 only checks that `dev_stack_status(id)` is `up` and that `stack.taskId` or `stack.mergedTaskIds` includes this task (otherwise stop and say so), with no start or refresh. Run steps 1, 3 and 4 and return the banner and plan with results, plus the exact steps a human should follow for each ⚠️. Skip step 5 entirely: no stack stop, no questions, no Jira.

## 1. Context

`get_task(id)` → `title`, `jiraKey`, `prNumber`, `repository`, `headBranch`, `baseBranch`. No PR: stop.

Gather what the change is supposed to do: Jira description and acceptance criteria (`getAccessibleAtlassianResources` for the cloud id, then `getJiraIssue` with `responseContentFormat: "markdown"`), `gh pr view <pr> --json title,body,isDraft,headRefOid`, and `gh pr diff <pr>` to see which screens and flows are touched.

## 2. Dev stack

`dev_stack_status(id)`:

- `supported: false`: stop, this repository has no dev stack.
- Stack owned by another task or PR (neither `stack.taskId` nor `stack.mergedTaskIds` is this task, or `prUrl` set): stop and tell the user. Never stop someone else's stack.
- Owned by this task and `up`: `refresh_dev_stack(id)` so it runs the PR's latest commit.
- Owned by this task and `failed`, or no stack: `start_dev_stack(id)`.

While it boots, check the browser (`references/browser-run.md`, first paragraph). Then call `dev_stack_status(id, waitSeconds: 300)` until the state is `up` or `failed`. On `failed`, read `error` and the end of `logTail`. A local-environment fault is yours to repair: a stray `node_modules` directory blocking `pnpm install`, a local Elasticsearch mapping conflict, a crashed container. Touch only generated or local state, never tracked files or other worktrees. Then `start_dev_stack(id)` once more and mention the repair in the report. A failure that comes from the PR itself, or a second failed boot: print both and stop.

## 3. Test plan

Write a short numbered plan: the happy path of each acceptance criterion, the key edge cases the diff suggests (empty states, permissions, validation errors, long content), and a regression check on the screens around the change. Tag each item with who performs it (member, network admin, super admin) so sign-ins are planned up front. The stack serves `stack.url` (alumni_connect: the community app; front-monorepo: Storybook, where QA means the touched stories). For front-monorepo, a state no story or control reaches (Storybook also refuses URL `args=`), or a component that only lives in the playground app, goes through the playground MCP (`mcp__playground__screenshot_story` / `check_story` with knobs), not to a human.

## 4. Run it in Chrome

Follow `references/browser-run.md`: the planning model checks the browser and mints sign-ins, Haiku subagents do the clicking one role group at a time, and the planning model keeps the verdict on each item (✅ passed, ❌ failed with what was seen vs. expected, ⚠️ not verified with why).

Signing in (alumni_connect): never type passwords. `dev_stack_login_link(taskId, as, id?)` returns a single-use `url` (10 minutes) that signs the tab in when opened: `as` is `member` (front office), `admin` (network back office) or `super_admin` (network back office as super admin); `id` picks a specific user or admin when the plan needs one. Mint a fresh link for every sign-in or role switch.

## 5. Report and wrap up

Print a banner (`🧪 AI QA · <jiraKey> · ✅ N · ❌ N · ⚠️ N`) and the plan with each item's result.

- **All ✅**: `stop_dev_stack(id)`, then wrap up the task (`references/wrap-up.md`).
- **Any ❌**: leave the stack up and the PR as is. List the failures with reproduction steps.
- **⚠️ but no ❌**: leave the stack up at `stack.url` and ask the human, through AskUserQuestion, to validate the ⚠️ items, each with exact steps you have checked can be followed (the control, page and role exist). On "All good", wrap up as for all ✅. On "Found issues", leave everything as is.
