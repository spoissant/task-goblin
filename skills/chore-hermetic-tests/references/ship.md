# Shipping the pair

## alumni_connect PR

When seeds or test ids changed: `Skill(hivebrite-engineering:github-commit)` here, `git push`, `sync_task(id)`. The PR stays a draft; `/chore-code-review-my-pr` marks it ready, and its CI then runs the paired hivetests branch.

## A paired PR already open

Commit in the hivetests worktree and push to it. No new sub-task or PR. `sync_task` on its task.

## The Jira sub-task

The hivetests work is its own Task Goblin task, so it goes through the usual chores: AI QA (no dev stack, so it only moves Jira to Code Review), self review (marks it ready), reviews by the squad that owns the feature folder.

`createJiraIssue`: a Sub-task under `jiraKey` (or under its parent when `jiraKey` is itself a sub-task), summary `[hivetests] Hermetic specs for <ticket summary>`, assigned to the user (`atlassianUserInfo`). A sub-task takes its parent's sprint. Move it to In Progress: the plugin's `executeRead` operation `listJiraIssueTransitions`, then `transitionJiraIssue`. Then `sync`, `get_task(jiraKey: <sub-task key>)`, and `update_task` with `repository: "hivetests"`.

## hivetests commit and PR

Run these from the hivetests worktree (`cd` there, back here afterwards):

1. `Skill(hivebrite-engineering:github-commit)`. The repo's style is `test(<feature>): <what> [<sub-task key>]`.
2. `git push -u origin <branch>`.
3. `Skill(hivebrite-engineering:github-pr)` with the sub-task key, as a draft, with its Step 4 quality suggestions skipped. The title carries the sub-task key, which is how Task Goblin pairs the PR with the sub-task. The body follows the repo's template, links the alumni_connect PR, and says the two merge together: merging alumni_connect squash-merges this one, so it is never merged by hand.

Then `sync` and `get_task(jiraKey: <sub-task key>)`: it should now carry the PR. If it does not, `create_task("Hivebrite", "hivetests", <prNumber>)`.

The "Hermetic Qase ids" workflow pushes a commit with the ids to the branch within minutes, so any later push from that worktree pulls first.
