---
name: chore-fix-merge-conflicts
description: Resolve merge conflicts on a PR branch by merging the base branch. Checks out the branch, merges, proposes resolutions if there are conflicts. Use for /chore-fix-merge-conflicts <taskId> or "fix merge conflicts".
allowed-tools: "ToolSearch,AskUserQuestion,Bash(git:*),Bash(yarn install*),Bash(bin/dev update-yarn*),Bash(pnpm i*),Bash(npx nx run *:version-alpha*),Bash(gh pr view*),Read,Grep,Glob,Edit,Skill(checkout-branch),mcp__task-goblin__get_task,mcp__task-goblin__list_tasks,mcp__task-goblin__update_task,mcp__task-goblin__sync_task"
---

# Fix Merge Conflicts

Numeric task ID argument (ask if missing). `get_task(id)` → `headBranch`, `baseBranch`, `jiraKey`, `prNumber`.

1. `Skill(checkout-branch)` with `headBranch`; if it fails, stop and tell the user.
2. `git fetch origin` then `git merge --no-ff origin/<baseBranch>`.
3. Clean merge: `git push origin <headBranch>` and report.
4. Conflicts: read each file from `git diff --name-only --diff-filter=U` and resolve hunk by hunk. Taking one side's whole file (`checkout --ours/--theirs`) also drops the other side's clean changes to it, so do that only when you re-apply them. Dependency pins in `package.json` / `yarn.lock`: `references/dependency-pins.md`.
   - Unambiguous conflicts only (both pins are stable releases → the higher wins; both sides add independent lines → keep both): apply without asking.
   - Otherwise show a summary (file, one-line proposed resolution) and ask "Apply proposed resolutions?" with Apply / Skip, plus the republish option from the reference when an alpha pin is involved.
   - Apply: resolve, check that `git diff origin/<base> -- package.json` shows only the branch's intended pins and that `yarn install --immutable` passes, `git add`, commit as `chore: merge <base> into <head> (resolve conflicts)`, push.
   - Skip: `git merge --abort` and `update_task(id, choreSkips: {"fix-merge-conflicts": true})` merged with existing keys.
5. After any push, `sync_task(id)` so task-goblin picks up the new PR state.

lefthook's `core.hooksPath` hint during commit is a known local setup issue; leave it out of the report. If the PR body names a pin that no longer matches, say so.
