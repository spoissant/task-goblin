# AI QA of a hivetests sub-task

The QA of a hermetic spec PR is running its specs against the alumni_connect parent's code. Task Goblin only offers this once the parent has a PR.

1. **Context.** `get_task(jiraKey: parentKey)` → the parent. `prepare_task_worktree(parentId)` → its worktree path. The specs are this PR's `*.hermetic.spec.ts` changes (`gh pr diff <pr> --name-only`), plus any spec the sub-task's Jira description lists as an update.
2. **Run.** Follow `~/.claude/skills/chore-hermetic-tests/references/local-run.md`. When the parent's own AI QA dev stack is up, leave it alone: the hermetic run uses the compose `test` service, not the dev stack.
3. **Banner and results.** `🧪 AI QA · <jiraKey> · hermetic` with ✅ / ❌ per spec. Each ❌ gets its side (spec or alumni_connect), cause and proposed fix.
4. **Fixes.** Spec-side fixes follow step 6 of the main flow: ask, apply in this worktree, `yarn lint`, commit with `Skill(hivebrite-engineering:github-commit)`, push (pull first: the Qase ids workflow pushes to this branch), and run again. An alumni_connect-side failure is reported for the parent, never edited from here, and leaves this sub-task where it is.
5. **All green.** Wrap up as for all ✅ (`references/wrap-up.md`).
