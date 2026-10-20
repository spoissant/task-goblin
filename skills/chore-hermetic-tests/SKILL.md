---
name: chore-hermetic-tests
description: Write the hermetic Playwright specs a hivetests sub-task's description plans for its alumni_connect parent, in the sub-task's worktree (a branch named like the parent's, so alumni_connect's build runs it and the two PRs merge together), then open the draft hivetests PR. Started by /chore-start-task while the parent is implemented; AI QA on the sub-task runs the specs later. Use for /chore-hermetic-tests <subtaskId>.
allowed-tools: "Bash,Read,Edit,Write,Grep,Glob,Agent,AskUserQuestion,ToolSearch,Skill(hivebrite-engineering:github-commit),Skill(hivebrite-engineering:github-pr),mcp__task-goblin__get_task,mcp__task-goblin__sync_task,mcp__task-goblin__sync,mcp__task-goblin__create_task,mcp__task-goblin__prepare_task_worktree,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue"
---

# Hermetic Specs

Numeric task ID (ask if missing): a hivetests sub-task of an alumni_connect task. The session runs in the sub-task's worktree. Load the MCP tools this skill uses with one `ToolSearch` `select:` query naming them exactly.

## 1. Context

`get_task(id)` → `jiraKey`, `parentKey`, `repository`, `prNumber`. Not hivetests, or no parent: stop. `get_task(jiraKey: parentKey)` → the parent's branch (`headBranch`, or the worktree's) and its worktree path via `prepare_task_worktree(parentId)`. `git branch --show-current` must equal the parent's branch: that name is the pairing. If it does not, stop and say so.

The sub-task's Jira description (`getJiraIssue`, `responseContentFormat: "markdown"`) holds the approved scenarios and each one's seed interface. The parent's ticket and its diff so far (`git -C <parent worktree> diff origin/sprint...`) say what the feature does.

## 2. Write

Follow `references/writing.md`. The seeds belong to the parent's session: code against the interface in the description. Never edit the parent's worktree. A scenario that cannot be written against that interface goes in the report with what it would need.

## 3. Run what can run

When the parent's worktree already registers every seed the specs call (`HermeticE2e::SeedsController::SEEDS`), run them per `references/local-run.md` and fix what fails on the spec side. Otherwise skip: AI QA on this sub-task runs them once the parent has a PR.

## 4. Ship

From this worktree: `Skill(hivebrite-engineering:github-commit)` (the repo's style is `test(<feature>): <what> [<sub-task key>]`), `git push -u origin <branch>`, then `Skill(hivebrite-engineering:github-pr)` with the sub-task key, as a draft, with its Step 4 quality suggestions skipped. The PR title carries the sub-task key, which is how Task Goblin pairs the PR with the sub-task. The body follows the repo's template, links the parent's PR (or names its branch), and says the two merge together: merging alumni_connect squash-merges this one, so it is never merged by hand. An existing PR: push to it.

`sync`, then `get_task(id)` should carry the PR. If it does not, `create_task("Hivebrite", "hivetests", <prNumber>)`.

## 5. Report

Banner `🧪 Hermetic specs · <sub-task key> → <parent key>`, then each scenario and its spec file, whether the local run happened and its result, anything that did not fit the seed interface, and the PR. The "Hermetic Qase ids" workflow pushes a commit to the branch within minutes, so a later push from this worktree pulls first.
