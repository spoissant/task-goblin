---
name: chore-ship-upstream
description: Merge green upstream PRs (api-contracts, front-monorepo, or both as a chain) after a go-ahead, wait for their releases and bump them in the alumni_connect PR that depends on them. Use for /chore-ship-upstream <alumniConnectTaskId> <upstreamTaskId> [<frontMonorepoTaskId>] or "ship the upstream PR".
allowed-tools: "Bash,Read,Edit,Grep,Glob,AskUserQuestion,ToolSearch,Monitor,Skill(checkout-branch),Skill(hivebrite-engineering:update-internal-sdks),Skill(hivebrite-engineering:github-commit),Skill(hivebrite-engineering:github-pr),Skill(chore-fix-pr-checks),Skill(chore-fix-merge-conflicts),mcp__task-goblin__sync_task,mcp__task-goblin__prepare_task_worktree"
---

# Ship Upstream PR

The alumni_connect task (the target) comes first, then the upstream task (ask for a missing one). The session runs in the target's worktree. Each upstream repo picks its reference for steps 2, 4 and 5: `references/api-contracts.md` or `references/front-monorepo.md`.

**Chain** — three task IDs: alumni_connect, api-contracts, front-monorepo. The front-monorepo PR pins a prerelease of the api-contracts SDK, so they ship in order: api-contracts, then the front-monorepo PR is re-pinned to its SDK release and shipped, then alumni_connect takes both releases. Any other set of repos: stop.

Waits happen in the background: a `run_in_background` Bash loop polling `gh` every minute, or Monitor, never a foreground sleep. A wait that has not resolved after 45 minutes stops the chore with a report of where it stalled.

## 1. Context

`sync_task` on each, which returns each refreshed `task` → `prNumber`, `prState`, `repository`, `headBranch`, `baseBranch`, `unresolvedCommentCount`. The target has an open PR or none yet (a bump-only target: the chore opens its PR in step 5); an upstream PR may be open or already merged (the user merged it with Task Goblin's Merge button). Chain: the front-monorepo PR must still be open, since it still needs the SDK bump (already merged: run the chore once per upstream instead); `prepare_task_worktree(front-monorepo)`, calling again while it is `preparing` (`failed`: stop with its `error`), and run every front-monorepo command in its `path`. Anything else: stop. `Skill(checkout-branch)` with the target's `headBranch`; without one, keep the worktree's branch (Task Goblin creates `<fix|chore|feat>/<TICKET>` from `origin/sprint`), and only if the worktree is detached create that branch from HEAD.

## 2. Green gate

Every PR must be green all the way; an already merged upstream PR only needs the upstream-specific condition, and a bump-only target has no PR to gate. Per PR, `gh pr view <n> --repo <owner/repo> --json state,isDraft,mergeable,reviewDecision,statusCheckRollup,headRefOid,labels`:

- open and not a draft;
- `mergeable` is `MERGEABLE` (`UNKNOWN` means GitHub is still computing: ask again);
- `reviewDecision` is `APPROVED`, and `unresolvedCommentCount` is 0;
- every check concluded success, neutral or skipped. Checks still running: wait for them, then judge.

Plus the upstream-specific condition from the reference. Anything red: stop and list, per PR, what is missing and the chore that fixes it (#3 conflicts, #4 PR comments, #5 checks, #10 reviews).

## 3. Go-ahead

Merging cannot be undone, so ask before it. AskUserQuestion with every PR's link and gate result, and the plan: merge the upstream PR (squash; left out when already merged), the release steps from the reference (front-monorepo: approve its release PRs), the dependencies that will be bumped in the alumni_connect PR, then commit and push (bump-only target: and open a draft PR). Chain: the plan is both merges in order, with the front-monorepo SDK bump between them. Options "Ship it" and "Stop". This answer also covers every later confirmation in the chore except a breaking-change gate.

## 4. Merge and wait for the release

Upstream PR already merged: skip to the wait, with its `headRefOid` from step 2.

Do the reference's pre-merge step first, if it has one (api-contracts: update the branch), and use the head it leaves.

`gh pr merge <n> --repo <owner/repo> --squash --match-head-commit <headRefOid from step 2>`, never `--admin`. A refused merge (the head moved, a check went red): stop and report. Then `sync_task(upstream)`, and wait for the release as the reference describes.

Chain: do this for api-contracts first. Then bump the front-monorepo PR as `references/api-contracts.md` describes ("Bump front-monorepo"), wait for the checks on its new head and rerun the step 2 gate on it, with the step 6 repairs (front-monorepo task ID). A drop in its `reviewDecision`: stop and report, since a re-approval is the user's. Then merge front-monorepo the same way, with its new `headRefOid`, and wait for its release.

## 5. Bump the alumni_connect PR

Follow the reference (chain: both references, in one commit), then run the commit through `Skill(hivebrite-engineering:github-commit)` and `git push`. Bump-only target: open the PR with `Skill(hivebrite-engineering:github-pr)` against `sprint`, as a draft, with its Step 4 quality suggestions skipped and a body saying it only bumps to the upstream release; then `sync_task(target)`.

## 6. Green again

Wait for the checks on the new head, then `sync_task(target)` and rerun the step 2 gate on the alumni_connect PR. A PR this chore opened is a draft without approvals: gate only its checks and conflicts.

- Failing checks: `Skill(chore-fix-pr-checks)` with the target task ID, wait again, re-gate.
- Conflicts: `Skill(chore-fix-merge-conflicts)` with the target task ID, wait again, re-gate.
- One repair round per kind; still red after it: report.
- Approvals do not get dismissed by a push on these repos, so a drop in `reviewDecision` means a reviewer acted: report it, don't re-request.

Never merge the alumni_connect PR: the user validates and merges it.

## 7. Report

Banner `🚢 Ship upstream · <upstream repo>#<n> → alumni_connect#<n> · ✅ ready for your validation` (chain: `api-contracts#<n> → front-monorepo#<n> → alumni_connect#<n>`; or `❌ stopped at step <N>`), then: the merged PRs, the front-monorepo SDK bump (chain), the releases with versions (and release PRs approved), each dependency bumped from → to, the alumni_connect PR's link (say when the chore opened it) and gate result, and anything left for the user.
