# Batch AI QA: several tasks on one stack

All tasks must be in the same repository and have a PR; drop (and report) any without one.

## 1. One stack for all

`dev_stack_status(first)` and apply the ownership rule of SKILL.md step 2. A stack already up with exactly these tasks (`taskId` plus `mergedTaskIds`) is reused: `refresh_dev_stack(first)`. A stack owned by these tasks with a different set: ask before stopping it. Otherwise `start_dev_stack(first, withTaskIds: rest)`, then `dev_stack_status(first, waitSeconds: 300)` until `up` or `failed`. While it boots, check the browser once (`tabs_context_mcp`; none connected: ask through AskUserQuestion to connect the extension).

On `failed`, print `error`. A merge conflict names the branch that does not merge on top of the others: offer to retry without it (QA it alone later), or stop.

## 2. QA each task, one at a time

For each task in turn, run a subagent (Agent tool, general-purpose) with the prompt `/chore-ai-qa <id> --stack-ready`, and wait for its report before starting the next. Never run them in parallel: they share one Chrome profile (a sign-in in one tab replaces the session of every other tab) and one database. If a subagent reports no browser connected, ask through AskUserQuestion to reconnect, then rerun that task.

## 3. Report and validate

Print each task's banner and plan, then one summary line per task. A ❌ on a merged stack may come from the PRs interacting rather than from the task itself; say so when the failure touches code another task in the batch changed.

If any task has ⚠️ items, ask the human once, through AskUserQuestion, with one question per task listing its ⚠️ items and steps, the stack still up at `stack.url`. A task counts as passed when it has no ❌ and its ⚠️ were answered "All good".

## 4. Wrap up

Wrap up every passed task (`references/wrap-up.md`), even when others failed. Then `stop_dev_stack(first)` if every task passed; otherwise leave the stack up and list the failures with reproduction steps per task.
