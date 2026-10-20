---
name: chore-hermetic-tests
description: Decide whether an alumni_connect PR needs new or updated hermetic Playwright specs in hivetests — after AI QA, before /chore-code-review-my-pr — then, once the user approves the scenario list, write them on a hivetests branch named like the alumni_connect one (alumni_connect's build then runs it and the two PRs merge together), add any seed they need to the alumni_connect PR, run them locally until green, and open the paired draft hivetests PR under its own Jira sub-task. Use for /chore-hermetic-tests <taskId>, "does this need hermetic tests", or "add hermetic specs for this PR".
allowed-tools: "Bash,Read,Edit,Write,Grep,Glob,Agent,AskUserQuestion,ToolSearch,Monitor,Skill(checkout-branch),Skill(hivebrite-engineering:github-commit),Skill(hivebrite-engineering:github-pr),mcp__task-goblin__get_task,mcp__task-goblin__sync_task,mcp__task-goblin__sync,mcp__task-goblin__update_task,mcp__task-goblin__create_task,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__atlassianUserInfo,mcp__plugin_hivebrite-engineering_atlassian__createJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__executeRead,mcp__plugin_hivebrite-engineering_atlassian__transitionJiraIssue"
---

# Hermetic Tests

Numeric task ID (ask if missing): an alumni_connect task whose PR passed AI QA and is still a draft. The session runs in its worktree. hivetests' main checkout is `~/Code/hivebrite/hivetests`; leave its working tree alone and work in a worktree of it.

Choosing the chore is the go-ahead for everything except writing tests: the scenario list waits for the user's approval (step 3). Load the MCP tools this skill uses with one `ToolSearch` `select:` query naming them exactly.

## 1. Context

`get_task(id)` → `jiraKey`, `headBranch`, `prNumber`, `repository`, `choreSkips`. Not alumni_connect, or no PR: stop. `Skill(checkout-branch)` with `headBranch`. The Jira ticket (`getJiraIssue`, `responseContentFormat: "markdown"`) and `gh pr diff <pr>` say what changed.

The rules are read from the source, not from memory: `git -C ~/Code/hivebrite/hivetests fetch origin main`, then `git show origin/main:docs/pr-review.md` (§0 test level, plus the sections a spec is reviewed on) and `origin/main:AGENTS.md`; in this worktree, `docs/testing/HERMETIC_PLAYWRIGHT.md` ("What a hermetic spec cannot do", "Adding a scenario").

`gh pr list -R Hivebrite/hivetests --head <headBranch> --state all`: an open paired PR already exists → this run updates it.

## 2. Evaluate

One `Explore` agent with `model: "sonnet"` maps current coverage on hivetests `origin/main` (through `git grep` / `git show`) and this worktree's `lib/hermetic_e2e/seeds/`: the `*.hermetic.spec.ts` and seeds for the touched feature, what each asserts, and which ones exercise the screens or behaviour the diff changes. About 40 lines with `file:line`.

Sort each behaviour the PR changes into one bucket, by pr-review §0:

- **New hermetic**: lives in alumni_connect, visible through the UI (permissions, validation, rendering, business rules, flag combinations, an edge case), and not already proven by the PR's own rspec/jest at a lower level.
- **Update**: an existing spec or seed the diff makes wrong or stale.
- **Regression run**: existing specs on the touched screens, run locally in step 4 even when nothing is written, since the draft PR's CI skips hermetic.
- **E2E only**: crosses a deployable or needs real infrastructure. Report it; a Qase case from the QA analysts comes first, so it is not written here.
- **Not worth a browser test**: say why in one line.

## 3. Approve

Banner `🧪 Hermetic · <jiraKey> · <n> to write` and the numbered list: each scenario's bucket, title in the user's perspective, roles, flags, seed (reused with which options, or new), and target spec file. Ask once for approval or edits. Nothing to write: skip to step 4's regression run, then step 6.

## 4. Write and run

Follow `references/writing.md` for the hivetests worktree, seeds, specs and the local run. Iterate until the approved specs and the regression run are green locally. A failure that is the PR's bug, not the test's: stop, report it with the evidence, and leave the fix to the user (it reopens AI QA).

## 5. Ship

Follow `references/ship.md`: the seed commit on this PR, the Jira sub-task, the hivetests commit and draft PR, and linking it in Task Goblin.

## 6. Finish

Always, whatever the verdict: `update_task(id, choreSkips)` with the existing map plus `"hermetic-tests": true`, which releases `/chore-code-review-my-pr`. Then report: the banner, each scenario and its spec file, the regression run's result, the E2E-only items, the hivetests PR and sub-task, and the reminder that alumni_connect's `hivetests-companion` status stays pending until the hivetests PR is approved and green, and that merging alumni_connect merges it (never by hand).
