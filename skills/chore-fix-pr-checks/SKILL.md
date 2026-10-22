---
name: chore-fix-pr-checks
description: Investigate failed PR checks, classify each failure as caused by this PR or external/flaky, and produce a structured report; fixes and pushes failures this PR caused, and merges the base branch or re-triggers CI when they are not ours. Use for "investigate checks", "why are checks failing", "fix pr checks", or /chore-fix-pr-checks <taskId>.
allowed-tools: "Bash(gh:*),Bash(git diff*),Bash(git log*),Bash(git rev-parse*),Bash(git fetch*),Bash(git merge*),Bash(git push*),Bash(git status*),Bash(git add*),Bash(git commit*),Bash(git checkout -- *),Bash(yarn test*),Bash(yarn typecheck*),Bash(bin/dev*),Read,Grep,Glob,Edit,ToolSearch,Skill(checkout-branch),Skill(hivebrite-engineering:github-commit),mcp__task-goblin__get_task,mcp__task-goblin__list_task_sessions,mcp__plugin_hivebrite-engineering_buildkite__get_build_failure_summary,mcp__plugin_hivebrite-engineering_buildkite__search_logs,mcp__plugin_hivebrite-engineering_buildkite__get_failed_executions,mcp__plugin_hivebrite-engineering_buildkite__list_jobs,mcp__plugin_hivebrite-engineering_buildkite__list_annotations,mcp__plugin_hivebrite-engineering_buildkite__list_artifacts_for_build,mcp__plugin_hivebrite-engineering_buildkite__get_test,mcp__plugin_hivebrite-engineering_buildkite__list_builds,mcp__plugin_hivebrite-engineering_buildkite__retry_job"
---

# Fix PR Checks

Classify before changing code. A failing check is often infra (Docker, clone, runner disconnect) or an unrelated flaky spec; for those the fix is merging the latest base branch and re-running CI, not editing code. Touch code only once a failure is confirmed to come from this PR's diff.

## Resolve the task

Numeric argument → `get_task(id)`; otherwise `get_task(branch: <current branch>)`; otherwise ask for a PR URL. Take `prNumber`, `repo`, `headBranch`, `baseBranch` (default `sprint`). No PR: say so and stop.

`Skill(checkout-branch)` with `headBranch`; if it fails, stop and tell the user.

## Gather

1. Head SHA: `gh api repos/<o>/<r>/pulls/<pr> --jq .head.sha`.
2. Failed check runs (`conclusion` failure or timed_out) from `commits/<sha>/check-runs --paginate`, and failed commit statuses from `commits/<sha>/status`. CI systems use both. Nothing failed: say all checks pass and stop.
3. Annotations for each failed run: `check-runs/<id>/annotations` gives file, line, and message.
4. Buildkite, when a check's `app.slug` is `buildkite` or its URL is on buildkite.com: load `get_build_failure_summary`, `search_logs`, `get_failed_executions`, `list_builds` and `retry_job` in one `ToolSearch` select, then call `get_build_failure_summary`. It returns failed jobs, log tails, annotations and failed tests in one call, which is richer than GitHub annotations. Use `search_logs` / `get_failed_executions` only for a job whose tail doesn't show the cause. `broken` and `waiting_failed` jobs never ran, so they are not failures.
5. Our changes: `git diff <base>...HEAD --name-only` and `git log <base>...HEAD --oneline`.
6. Prior attempts: `list_task_sessions(id)` filtered to this chore, and the check runs of the previous one or two head SHAs (`pulls/<pr>/commits`). A check that already failed on an earlier head, or a chore that already ran for this task, marks this as a repeat.

## Reproduce locally

When the failures are only unit tests (Jest, RSpec) and there are at most five of them, run them here before classifying: `yarn test <file>` for Jest, `bin/dev dcx test bin/rspec <spec>` for RSpec, from the worktree where the branch is checked out. Start the run in the background as soon as the failing specs are known, and keep gathering and classifying the other checks while it runs. Passing locally is a strong flaky signal; failing locally means the regression is real.

## Classify

| | Criteria |
|---|---|
| Our Fault | failing test or file matches a changed file; error references our code |
| Likely Ours | adjacent to our changes: imports, dependencies, related modules |
| External (Flaky) | passes locally, failed on CI |
| External | no overlap with our changes; infra failure |
| Unclear | ambiguous overlap or insufficient data |

Group checks that share a root cause. A timeout with no logs is External unless the timeout is new with our changes. An unrelated flaky test stays External even when its name sounds related.

## Fix our failures

Our Fault or Likely Ours with a clear fix: make it, run the failing test (or typecheck) locally, commit with `Skill(hivebrite-engineering:github-commit)`, and push together with any pending base merge. Ask first only when the fix changes product behaviour rather than a test, type, fixture or mock.

## Merge the base branch

When not every failure is Our Fault: `git fetch origin <base>` then `git merge origin/<base> --no-ff --no-edit`.

- Merge brings in commits and every failure is External or Flaky (no code change needed anywhere): `git push`, so CI re-runs without waiting on the user. Exception: on a repeat (step 6) where the failing specs differ from the previous run's, and the merge brings nothing that touches them, leave the merge unpushed and `retry_job` the failed jobs instead. A push restarts the whole build.
- Merge succeeds but some failure needs a code fix: push after the fix (see Fix our failures), so one CI run covers both.
- Conflict: `git merge --abort` and report that the user must resolve it first.
- Already up to date: there is nothing to push, so a re-run has to be triggered on the check itself. See below.

The alumni_connect post-merge hook `008_generate-routes-definition` often reports a failure and may rewrite `front/packages/routes/generated/routes.{js,d.ts}`; restore those files with `git checkout -- front/packages/routes/generated` and leave it out of the report.

## Already up to date

Flaky and infra failures (passes locally, Docker, clone, agent lost, OOM) still deserve a re-run: `retry_job` for a Buildkite job, `gh run rerun <run-id> --failed` for a GitHub Actions run.

Other External or Unclear failures on a repeat (step 6) are suspect: the base may be broken. Check it before re-running anything: `list_builds` on `<base>`, latest few, and look for the same failed step.

- The base fails on the same step: verdict `BLOCKED BY SPRINT`. Do not push or re-run. Report the base build and the base commits that touched the referenced files since its last green build (`git log origin/<base> --oneline -- <files>`).
- The base is green there: re-run the individual failed check once, as above, to confirm or rule out flakiness, and say so in the report.

## Report

Write the report described in `references/report-format.md`.
