---
name: chore-preview-upstream
description: Pin the alumni_connect PR to a prerelease of the upstream PR it depends on, before the upstream merges — front-monorepo publishes an alpha of the packages the upstream branch changes, api-contracts waits for the SDK branch build CI makes on every push — then bumps the alumni_connect PR to it and pushes. /chore-ship-upstream later moves it to the stable release. Use for /chore-preview-upstream <alumniConnectTaskId> <upstreamTaskId>, "publish an alpha", or "preview the upstream PR in alumni_connect".
allowed-tools: "Bash,Read,Edit,Grep,Glob,AskUserQuestion,ToolSearch,Monitor,Skill(checkout-branch),Skill(hivebrite-engineering:update-internal-sdks),Skill(hivebrite-engineering:github-commit),mcp__task-goblin__get_task,mcp__task-goblin__sync_task,mcp__task-goblin__prepare_task_worktree"
---

# Preview Upstream PR

Two task IDs: the alumni_connect task (the target), then the upstream task (ask for a missing one). The session runs in the target's worktree. The upstream repo picks the reference for steps 2 and 3: `references/api-contracts.md` or `references/front-monorepo.md`. Any other pair: stop.

Choosing the chore is the go-ahead: publishing a prerelease and pushing to the alumni_connect PR need no further confirmation, except a breaking-change gate.

Waits happen in the background: a `run_in_background` Bash loop polling `gh` every minute, or Monitor, never a foreground sleep. A wait that has not resolved after 30 minutes stops the chore with a report of where it stalled.

## 1. Context

`sync_task` then `get_task` on both → `headBranch`, `prNumber`, `repository`, `uncommittedFiles`, `unpushedCommits`. A task without a branch: stop. `Skill(checkout-branch)` with the target's `headBranch`.

## 2. Build the prerelease

Follow the reference. It also says which dependencies of the alumni_connect PR the prerelease covers. None of them is pinned in alumni_connect: stop and say so.

## 3. Bump the alumni_connect PR

Follow the reference, then run the commit through `Skill(hivebrite-engineering:github-commit)` and `git push`. Then `sync_task(target)`. CI on the alumni_connect PR is left to the usual chores (#5 fix PR checks).

## 4. Report

Banner `🧪 Preview upstream · <upstream repo> <branch> → alumni_connect#<n>`, then: each prerelease (package or SDK, version or SHA), each dependency bumped from → to, what the prerelease left out (uncommitted or unpushed upstream work, as the reference defines it), and the reminder that `/chore-ship-upstream` replaces the prerelease with the stable release once the upstream PR is green.
