---
name: chore-deploy-to-test-env
description: Deploy one or more Task Goblin tasks' PR branches to a test environment by merging them into the env branch from a throwaway worktree and pushing once. Use for /chore-deploy-to-test-env <taskId> [<taskId>…] <env> [--skip-tests] [--monitor] or "deploy task to test env".
allowed-tools: "mcp__task-goblin__get_task,Bash,Read,Edit,Skill(hivebrite-engineering:staging-deploy)"
---

# Deploy to Test Environment

Arguments: one or more numeric task IDs, then the env name (ask if missing); flags `--skip-tests`, `--monitor`.

## Stay in the current worktree

Sibling checkouts are usually busy (other sessions, a running `bin/dev` stack). A `git checkout` there swaps their tree mid-task and fires lefthook's post-checkout chain against their stack; checking the env branch out here clobbers the user's branch. So all git work happens in a temporary worktree created below. `/staging-deploy` says to `cd $HIVEBRITE_DEV_DIR/alumni_connect`; ignore that line. If the throwaway flow cannot proceed, ask before touching any other checkout.

## Steps

1. `get_task(id)` per task → `headBranch`, `prNumber`. No `headBranch`: report it and drop that task. Don't wait for the PR's CI; if it is still running or failing, flag the risk in the report.

2. The env branch is the env name (`staging`, `wip`, `barney`, `integration`, `dea`, `mobile`, `qa`). The old `deploy/ephenv=*` branches are deprecated.

3. Merge every task branch, in the order given, into one throwaway worktree, then push once:

   ```bash
   ENV_BRANCH="<env>"; WT="$(mktemp -d)/deploy-$ENV_BRANCH"
   git fetch origin
   git ls-remote --exit-code --heads origin "$ENV_BRANCH" <each headBranch> >/dev/null
   # detached at origin/$ENV_BRANCH; hooksPath=/dev/null only silences post-checkout here,
   # merge and push keep their hooks (the pre-push schema gate still runs).
   git -c core.hooksPath=/dev/null worktree add --detach "$WT" "origin/$ENV_BRANCH"
   git -C "$WT" merge --no-ff "origin/$B" -m "Merge $B into $ENV_BRANCH"   # per branch
   git -C "$WT" push origin "HEAD:refs/heads/$ENV_BRANCH"
   ```

   Merge messages are plain. Only with `--skip-tests`, append the papi-deploy marker (in square brackets) to the last merge message; it makes the env build skip all tests. Every push deploys, marker or not.

   `--no-ff` keeps the feature tip as the merge's second parent, which task-goblin's deployed-branch detection relies on.

   On a conflict: abort and redo from a fresh worktree, merging `origin/sprint` first (`-m "Merge sprint into $ENV_BRANCH"`), then the task branches. Don't ask first. Env branches lag sprint and task branches carry sprint changes unrelated to the PR; this separates that drift from the PR's own changes.

   Conflicts that remain: resolve file by file per `references/conflicts.md` (Edit, or `git merge-file` on one classified file; no loop applying one side to every conflicted file). Ask only for the cases listed there under "Ask"; otherwise resolve, push, and list each resolution in the report.

   Push rejected as non-fast-forward: redo step 3 from a fresh fetch and worktree. Never rebase, force-push or reset the env branch: it is shared, and a rebase flattens the merge-parent chain. A second failure is reported and stops.

4. `gh pr edit <prNumber> --add-label "merged in $ENV_BRANCH"` per PR, then `git worktree remove --force "$WT"` on every path including failures, and check `git worktree list` is clean.

5. Report: one row per task (branch, PR, merge SHA and parents), every conflict resolution, anything skipped and why, and the links `https://buildkite.com/hivebrite/alumni-connect/builds?branch=<env>` and `https://<env>.hvbrt.com/backoffice/admins/sign_in`. Mention tests only if `--skip-tests` was used.

## --monitor

After the push, delegate only build tracking, rollout and health check to `Skill(hivebrite-engineering:staging-deploy)`, stating that the merge is already done and no git work is needed.
