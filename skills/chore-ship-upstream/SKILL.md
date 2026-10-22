---
name: chore-ship-upstream
description: Merge a green upstream PR (api-contracts or front-monorepo) after a go-ahead, wait for its release and bump it in the alumni_connect PR that depends on it. Use for /chore-ship-upstream <alumniConnectTaskId> <upstreamTaskId> or "ship the upstream PR".
allowed-tools: "Bash,Read,Edit,Grep,Glob,AskUserQuestion,ToolSearch,Monitor,Skill(checkout-branch),Skill(hivebrite-engineering:update-internal-sdks),Skill(hivebrite-engineering:github-commit),Skill(hivebrite-engineering:github-pr),Skill(chore-fix-pr-checks),Skill(chore-fix-merge-conflicts),mcp__task-goblin__sync_task"
---

# Ship Upstream PR

Two task IDs: the alumni_connect task (the target), then the upstream task (ask for a missing one). The session runs in the target's worktree. The upstream repo picks the reference for steps 2, 4 and 5: `references/api-contracts.md` or `references/front-monorepo.md`. Any other pair: stop.

Waits happen in the background: a `run_in_background` Bash loop polling `gh` every minute, or Monitor, never a foreground sleep. A wait that has not resolved after 45 minutes stops the chore with a report of where it stalled.

## 1. Context

`sync_task` on both, which returns each refreshed `task` → `prNumber`, `prState`, `repository`, `headBranch`, `baseBranch`, `unresolvedCommentCount`. The target has an open PR or none yet (a bump-only target: the chore opens its PR in step 5); the upstream PR may be open or already merged (the user merged it with Task Goblin's Merge button). Anything else: stop. `Skill(checkout-branch)` with the target's `headBranch`; without one, keep the worktree's branch (Task Goblin creates `<fix|chore|feat>/<TICKET>` from `origin/sprint`), and only if the worktree is detached create that branch from HEAD.

## 2. Green gate

Both PRs must be green all the way; an already merged upstream PR only needs the upstream-specific condition, and a bump-only target has no PR to gate. Per PR, `gh pr view <n> --repo <owner/repo> --json state,isDraft,mergeable,reviewDecision,statusCheckRollup,headRefOid,labels`:

- open and not a draft;
- `mergeable` is `MERGEABLE` (`UNKNOWN` means GitHub is still computing: ask again);
- `reviewDecision` is `APPROVED`, and `unresolvedCommentCount` is 0;
- every check concluded success, neutral or skipped. Checks still running: wait for them, then judge.

Plus the upstream-specific condition from the reference. Anything red: stop and list, per PR, what is missing and the chore that fixes it (#3 conflicts, #4 PR comments, #5 checks, #10 reviews).

## 3. Go-ahead

Merging cannot be undone, so ask before it. AskUserQuestion with both PRs' links and gate results, and the plan: merge the upstream PR (squash; left out when already merged), the release steps from the reference (front-monorepo: approve its release PRs), the dependencies that will be bumped in the alumni_connect PR, then commit and push (bump-only target: and open a draft PR). Options "Ship it" and "Stop". This answer also covers every later confirmation in the chore except a breaking-change gate.

## 4. Merge and wait for the release

Upstream PR already merged: skip to the wait, with its `headRefOid` from step 2.

Do the reference's pre-merge step first, if it has one (api-contracts: update the branch), and use the head it leaves.

`gh pr merge <n> --repo <owner/repo> --squash --match-head-commit <headRefOid from step 2>`, never `--admin`. A refused merge (the head moved, a check went red): stop and report. Then `sync_task(upstream)`, and wait for the release as the reference describes.

## 5. Bump the alumni_connect PR

Follow the reference, then run the commit through `Skill(hivebrite-engineering:github-commit)` and `git push`. Bump-only target: open the PR with `Skill(hivebrite-engineering:github-pr)` against `sprint`, as a draft, with its Step 4 quality suggestions skipped and a body saying it only bumps to the upstream release; then `sync_task(target)`.

## 6. Green again

Wait for the checks on the new head, then `sync_task(target)` and rerun the step 2 gate on the alumni_connect PR. A PR this chore opened is a draft without approvals: gate only its checks and conflicts.

- Failing checks: `Skill(chore-fix-pr-checks)` with the target task ID, wait again, re-gate.
- Conflicts: `Skill(chore-fix-merge-conflicts)` with the target task ID, wait again, re-gate.
- One repair round per kind; still red after it: report.
- Approvals do not get dismissed by a push on these repos, so a drop in `reviewDecision` means a reviewer acted: report it, don't re-request.

Never merge the alumni_connect PR: the user validates and merges it.

## 7. Report

Banner `🚢 Ship upstream · <upstream repo>#<n> → alumni_connect#<n> · ✅ ready for your validation` (or `❌ stopped at step <N>`), then: the merged PR, the releases with versions (and release PRs approved), each dependency bumped from → to, the alumni_connect PR's link (say when the chore opened it) and gate result, and anything left for the user.
