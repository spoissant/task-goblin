---
name: chore-sprint-red
description: Attribute a red base-branch build after one of your PRs merged — reads the merge commit's sprint build (Buildkite for alumni_connect, GitHub Actions for front-monorepo), compares it with the previous build, and says whether the failure is yours, someone else's or flaky, with the evidence and, when it is yours, a fix-forward proposal at file:line. Read-only; started by the merge watch when the build fails. Use for /chore-sprint-red <taskId>, "the sprint build is red", or "did my merge break the build".
allowed-tools: "Bash(gh:*),Bash(git log*),Bash(git show*),Bash(git diff*),Bash(git fetch*),Read,Grep,Glob,ToolSearch,mcp__task-goblin__get_task,mcp__plugin_hivebrite-engineering_buildkite__user_token_organization,mcp__plugin_hivebrite-engineering_buildkite__get_build,mcp__plugin_hivebrite-engineering_buildkite__get_build_failure_summary,mcp__plugin_hivebrite-engineering_buildkite__compare_builds,mcp__plugin_hivebrite-engineering_buildkite__list_builds,mcp__plugin_hivebrite-engineering_buildkite__search_logs,mcp__plugin_hivebrite-engineering_buildkite__get_failed_executions"
---

# Sprint Build Red

The PR is merged; nothing here changes code or the build. The job is attribution: say who broke the base branch, prove it, and leave the user a decision. The session runs in the repo's main checkout.

## Resolve the task

Numeric argument → `get_task(id)`. Take `mergeCommitSha`, `baseBuildUrl`, `repository`, `prNumber`, `jiraKey`. No `mergeCommitSha`: say the merge was not recorded and stop.

`git fetch origin` then the PR's footprint: `git show --stat --format= <mergeCommitSha>` lists the files it changed; `git show <mergeCommitSha> -- <file>` gives the hunks when a failing step points at one.

## Gather the build

alumni_connect: `user_token_organization` for the org slug, then `get_build_failure_summary` on the build behind `baseBuildUrl` (its number is the last path segment). `compare_builds` against the previous finished `sprint` build (`list_builds` on branch `sprint`, state passed or failed, the one before ours) says which steps newly fail. `search_logs` or `get_failed_executions` only for a job whose tail does not show the cause. `broken` and `waiting_failed` jobs never ran.

front-monorepo: `gh run list --repo <owner/repo> --branch main --commit <mergeCommitSha> --json databaseId,name,conclusion`, then `gh run view <id> --log-failed` for each failed run; the previous build is `gh run list --branch main --limit 5` before ours.

## Bucket

One bucket per failing step, then one for the build (the worst of them):

- **mine**: the failing spec or step touches a file the PR changed, or the error names its code. Cite the failing spec and the `file:line` in the merge commit.
- **someone else's**: the step already failed on the previous base build, or the failing files are untouched by the PR. Name the commit or PR the compare points at (`git log origin/<base> --oneline -- <files>` since the last green build).
- **flaky**: passed on retry, or a known flaky signature (agent lost, Docker, clone, timeout with no assertion).

## Propose, do not act

For mine: the cause at `file:line` and the fix-forward, including the spec to update. Describe it; never edit, commit, push, open a PR, revert, merge or re-trigger a build. The user decides.

## Report

Banner `🔴 Sprint red · <jiraKey> · <bucket>`, then: the build link and failing steps with their bucket, the evidence per step (spec, `file:line`, previous build state, compare result), the proposed fix when mine, and what to do next: `/chore-start-task` on a fix ticket or `/chore-continue-work` on the task for mine, ping the owner for someone else's, nothing for flaky.
