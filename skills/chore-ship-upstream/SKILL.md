---
name: chore-ship-upstream
description: Ship an upstream PR (api-contracts or front-monorepo) into the alumni_connect PR that depends on it — checks both PRs are green (checks, approvals, no conflicts), asks for the go-ahead, merges the upstream PR, waits for its release (front-monorepo — approves the bot's release PRs), bumps the SDK or packages in the alumni_connect PR, pushes, and gets that PR green again. Never merges the alumni_connect PR. Use for /chore-ship-upstream <alumniConnectTaskId> <upstreamTaskId> or "ship the upstream PR".
allowed-tools: "Bash,Read,Edit,Grep,Glob,AskUserQuestion,ToolSearch,Monitor,Skill(checkout-branch),Skill(hivebrite-engineering:update-internal-sdks),Skill(hivebrite-engineering:github-commit),Skill(chore-fix-pr-checks),Skill(chore-fix-merge-conflicts),mcp__task-goblin__get_task,mcp__task-goblin__sync_task"
---

# Ship Upstream PR

Two task IDs: the alumni_connect task (the target), then the upstream task (ask for a missing one). The session runs in the target's worktree. The upstream repo picks the reference for steps 2, 4 and 5: `references/api-contracts.md` or `references/front-monorepo.md`. Any other pair: stop.

Waits happen in the background: a `run_in_background` Bash loop polling `gh` every minute, or Monitor, never a foreground sleep. A wait that has not resolved after 45 minutes stops the chore with a report of where it stalled.

## 1. Context

`sync_task` then `get_task` on both → `prNumber`, `repository`, `headBranch`, `baseBranch`, `unresolvedCommentCount`. A task without an open PR: stop. `Skill(checkout-branch)` with the target's `headBranch`.

## 2. Green gate

Both PRs must be green all the way. Per PR, `gh pr view <n> --repo <owner/repo> --json state,isDraft,mergeable,reviewDecision,statusCheckRollup,headRefOid,labels`:

- open and not a draft;
- `mergeable` is `MERGEABLE` (`UNKNOWN` means GitHub is still computing: ask again);
- `reviewDecision` is `APPROVED`, and `unresolvedCommentCount` is 0;
- every check concluded success, neutral or skipped. Checks still running: wait for them, then judge.

Plus the upstream-specific condition from the reference. Anything red: stop and list, per PR, what is missing and the chore that fixes it (#3 conflicts, #4 PR comments, #5 checks, #10 reviews).

## 3. Go-ahead

Merging cannot be undone, so ask before it. AskUserQuestion with both PRs' links and gate results, and the plan: merge the upstream PR (squash), the release steps from the reference (front-monorepo: approve its release PRs), the dependencies that will be bumped in the alumni_connect PR, then commit and push. Options "Ship it" and "Stop". This answer also covers every later confirmation in the chore except a breaking-change gate.

## 4. Merge and wait for the release

`gh pr merge <n> --repo <owner/repo> --squash --match-head-commit <headRefOid from step 2>`, never `--admin`. A refused merge (the head moved, a check went red): stop and report. Then `sync_task(upstream)`, and wait for the release as the reference describes.

## 5. Bump the alumni_connect PR

Follow the reference, then run the commit through `Skill(hivebrite-engineering:github-commit)` and `git push`.

## 6. Green again

Wait for the checks on the new head, then `sync_task(target)` and rerun the step 2 gate on the alumni_connect PR.

- Failing checks: `Skill(chore-fix-pr-checks)` with the target task ID, wait again, re-gate.
- Conflicts: `Skill(chore-fix-merge-conflicts)` with the target task ID, wait again, re-gate.
- One repair round per kind; still red after it: report.
- Approvals do not get dismissed by a push on these repos, so a drop in `reviewDecision` means a reviewer acted: report it, don't re-request.

`sync_task` on both tasks. Never merge the alumni_connect PR: the user validates and merges it.

## 7. Report

Banner `🚢 Ship upstream · <upstream repo>#<n> → alumni_connect#<n> · ✅ ready for your validation` (or `❌ stopped at step <N>`), then: the merged PR, the releases with versions (and release PRs approved), each dependency bumped from → to, the alumni_connect PR's link and gate result, and anything left for the user.
