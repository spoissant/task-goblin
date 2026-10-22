---
name: chore-ai-qa
description: QA a task's PR in Chrome on the local dev stack — a test plan from the Jira ticket and PR, failures fixed once approved, the ticket moved to Code Review on a pass. Use for /chore-ai-qa <taskId> [<taskId>…] or "AI QA this task / these tasks".
allowed-tools: "ToolSearch,AskUserQuestion,Agent,Bash(gh:*),Bash(git:*),Bash(yarn test*),Bash(bin/dev*),Read,Grep,Glob,Edit,Write,Skill(checkout-branch),Skill(hivebrite-engineering:github-commit),Bash(cd:*),Bash(env HIVETESTS_PATH=*),Bash(yarn lint*),Bash(yarn format*),mcp__task-goblin__get_task,mcp__task-goblin__prepare_task_worktree,mcp__task-goblin__dev_stack_status,mcp__task-goblin__start_dev_stack,mcp__task-goblin__refresh_dev_stack,mcp__task-goblin__stop_dev_stack,mcp__task-goblin__dev_stack_login_link,mcp__claude-in-chrome__*,mcp__playground__*,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__plugin_hivebrite-engineering_atlassian__executeRead,mcp__plugin_hivebrite-engineering_atlassian__transitionJiraIssue,Skill(hivebrite-engineering:jira-postmortem-bug)"
---

# AI QA

One or more numeric task IDs (ask if missing). Several IDs: follow `references/batch.md` instead of the steps below. Code changes only once the user approves them (step 6). The local stack is disposable, so local state is not code: seed data, post, upload and save through the UI, toggle flags in the main checkout's gitignored `launchdarkly.dev.yml` (restore them afterwards), and repair the local environment (step 2).

`--stack-ready` (set by the batch run): the stack is already up with this task in it. Step 2 only checks that `dev_stack_status(id)` is `up` and that `stack.taskId` or `stack.mergedTaskIds` includes this task (otherwise stop and say so), with no start or refresh. Run steps 1, 3 and 4, then step 6's diagnosis only. Return the banner and plan with results, the exact steps a human should follow for each ⚠️, and each ❌'s bucket, cause and proposed fix. Skip step 5 and the rest of step 6: no stack stop, no questions, no edits, no Jira.

## 1. Context

`get_task(id)` → `title`, `jiraKey`, `prNumber`, `repository`, `headBranch`, `baseBranch`. No PR: stop. A hivetests task with a `parentKey`: follow `references/hermetic.md` instead of the steps below.

Gather what the change is supposed to do: Jira description and acceptance criteria (`getAccessibleAtlassianResources` for the cloud id, then `getJiraIssue` with `responseContentFormat: "markdown"`), `gh pr view <pr> --json title,body,isDraft,headRefOid`, and `gh pr diff <pr>` to see which screens and flows are touched.

## 2. Dev stack

`dev_stack_status(id)`:

- `supported: false`: this repository has no dev stack, so nothing can be QA'd in Chrome. Skip steps 3–6, print the banner with no items (`🧪 AI QA · <jiraKey> · no dev stack`), and wrap up the task as for all ✅ (`references/wrap-up.md`).
- Stack owned by another task or PR (neither `stack.taskId` nor `stack.mergedTaskIds` is this task, or `prUrl` set): stop and tell the user. Never stop someone else's stack.
- Owned by this task and `up`: `refresh_dev_stack(id)` so it runs the PR's latest commit.
- Owned by this task and `failed`, or no stack: `start_dev_stack(id)`.

While it boots, check the browser (`references/browser-run.md`, first paragraph). Then call `dev_stack_status(id, waitSeconds: 300)` until the state is `up` or `failed`. On `failed`, read `error` and the end of `logTail`. A local-environment fault is yours to repair: a stray `node_modules` directory blocking `pnpm install`, a local Elasticsearch mapping conflict, a crashed container. Touch only generated or local state, never tracked files or other worktrees. Then `start_dev_stack(id)` once more and mention the repair in the report. A failure that comes from the PR itself, or a second failed boot: print both and stop.

## 3. Test plan

Write a short numbered plan: the happy path of each acceptance criterion, the key edge cases the diff suggests (empty states, permissions, validation errors, long content), and a regression check on the screens around the change. Tag each item with who performs it (member, network admin, super admin) so sign-ins are planned up front. Add a touch item for every input-sensitive change (forms, text fields, pickers, selects, anything typed into, focused, dragged or swiped): the same flow on a touch device, which the browser tools cannot emulate, so it is always a human's (`references/browser-run.md`, Touch). The stack serves `stack.url` (alumni_connect: the community app; front-monorepo: Storybook, where QA means the touched stories). For front-monorepo, a state no story or control reaches (Storybook also refuses URL `args=`), or a component that only lives in the playground app, goes through the playground MCP (`mcp__playground__screenshot_story` / `check_story` with knobs), not to a human.

## 4. Run it in Chrome

Follow `references/browser-run.md`: the planning model checks the browser and mints sign-ins, Haiku subagents do the clicking one role group at a time, and the planning model keeps the verdict on each item (✅ passed, ❌ failed with what was seen vs. expected, ⚠️ not verified with why).

Signing in (alumni_connect): never type passwords. `dev_stack_login_link(taskId, as, id?)` returns a single-use `url` (10 minutes) that signs the tab in when opened: `as` is `member` (front office), `admin` (network back office) or `super_admin` (network back office as super admin); `id` picks a specific user or admin when the plan needs one. Mint a fresh link for every sign-in or role switch.

## 5. Report and wrap up

Print a banner (`🧪 AI QA · <jiraKey> · ✅ N · ❌ N · ⚠️ N`) and the plan with each item's result.

- **All ✅**: `stop_dev_stack(id)`, then wrap up the task (`references/wrap-up.md`).
- **Any ❌**: leave the stack up and go to step 6.
- **⚠️ but no ❌**: leave the stack up at `stack.url` and ask the human, through AskUserQuestion, to validate the ⚠️ items, each with exact steps you have checked can be followed (the control, page and role exist). On "All good", wrap up as for all ✅. On "Found issues", take what they saw (their note, or ask) as ❌ items and go to step 6.

## 6. Fix failures

Diagnose every ❌ before proposing anything, from the subagent's evidence (console errors, failed requests), `gh pr diff` and the code it touches, and for a 5xx the Rails log of the service that served it (alumni_connect: `bin/dev dc logs --tail 300 webapi`, or `webapp`, `worker`). Each ❌ lands in one bucket:

- **PR bug**: the diff causes it. Propose the cause at `file:line`, the change, and the spec that covers it (new or updated).
- **Not from this PR**: the flow fails the same way without the diff. No fix here: it becomes ⚠️ with where it comes from, so the human decides whether it blocks.
- **Wrong expectation**: the plan misread the ticket or the design. Re-judge the item and say why.
- **Local environment** (stale data, crashed container, missing seed): repair it as in step 2 and re-run the item.

A cause you could not pin down, or a fix that needs a product decision: mark it ❓ and say what you need.

Print the proposals numbered, then ask once, through AskUserQuestion: "Apply the fixes" or "Leave as is" (stack stays up, nothing changes, the failures are listed with reproduction steps). An amendment through Other ("2: skip", "3: do X instead") is applied, then executed. No PR bug to fix: skip the question and go back to step 5 with the re-judged results.

Once approved: `Skill(checkout-branch)` with `headBranch`, make the changes, run the specs covering the touched files, commit with `Skill(hivebrite-engineering:github-commit)` and `git push`.

The run does not end at the push: the fixes are validated in Chrome before anything is reported. `refresh_dev_stack(id)` and check that `to` is the fix commit (a new migration or package needs `stop_dev_stack` then `start_dev_stack` instead). The stack stays `up` while the bundler recompiles, so call `dev_stack_status(id)` until its `logTail` shows a compile after the `refresh` line. Then re-run the fixed items and the regression checks on their screens (`references/browser-run.md`, fresh sign-in links), and go back to step 5 with the updated results: all ✅ wraps up, a ❌ comes back here, and each new round of fixes needs its own approval.
