---
name: chore-code-review-my-pr
description: Harsh review of the user's own PR against Hivebrite standards, then triage, fixes pushed and the PR marked ready (for colleagues' PRs use /chore-code-review-pr). Use when self-reviewing a PR or for /chore-code-review-my-pr <task ID or PR url>.
allowed-tools: "Workflow,Bash(gh:*),Bash(git:*),Bash(lavish-axi:*),Read,Grep,Glob,Edit,Write,ToolSearch,AskUserQuestion,Skill(checkout-branch),Skill(hivebrite-engineering:github-commit),mcp__task-goblin__get_task"
---

# Harsh Review (my PR)

Find real problems: bugs, security holes, architecture violations, design-system misuse, missing translations, reinvented wheels, performance landmines, testing gaps. Say what will go wrong in production and how to fix it, then fix what the user accepts.

The review rules are shared with `/chore-code-review-pr`; its `references/` live in `~/.claude/skills/chore-code-review-pr/references/` (called `REF` below).

## Input

A bare number is a Task Goblin task ID, never a PR number: resolve `prNumber`, `repo`, `headBranch` via `mcp__task-goblin__get_task`. Otherwise a PR URL, or nothing (current branch via `gh pr view`). If `gh api user --jq .login` is not the PR author, stop and point to `/chore-code-review-pr`.

## Workflow

1. **Checkout.** `Skill(checkout-branch)` with the PR head branch. If it fails, stop and tell the user.

2. **Fetch context.** `gh pr view --json number,title,body,author,baseRefName,headRefName,additions,deletions,changedFiles,url,isDraft`, `gh pr view --json files` (per-file line counts; gh has no `--stat`), then the full `gh pr diff` unless step 3 hands the review to the workflow. Also fetch existing review discussion with GraphQL (`reviewThreads` with `isResolved`, `isOutdated`, comments' `author`, `path`, `line`, `body`; plus PR-level `comments`). REST does not expose thread resolution state, which is the signal for "already dismissed".

3. **Scope.** Size the review by lines changed and note which domains are touched. Skip pure locale, asset, and generated files. Run steps 4–7 through the `review-pr` workflow (`REF/parallel-review.md`, mode `worktree`) only when the diff has both a backend and a frontend slice of real size, or a slice above ~60 files; then resume at step 7's tagging of existing reviewer comments with its verified findings. Otherwise review in one pass: you re-read the files to fix them anyway.

4. **Load standards** listed in `REF/standards.md` for the paths in the diff.

5. **Read critical files in full**, not just the diff: operations, models, controllers, anything security-sensitive. Diff is enough for specs, locales, schema, and generated files.

6. **Reinventing-the-wheel audit** with Grep/Glob, following `REF/reinvention.md`. Flag only clear equivalents.

7. **Review.** One coherent pass organised by `REF/checklist.md`, which also defines CRITICAL / WARNING / SUGGESTION. Each finding: bold one-line summary, real-world consequence, `file:line`, concrete fix. Tag findings that echo an existing reviewer comment ("↩ already raised by @X") and default-skip ones already resolved.

8. **Output.** Print a one-line verdict banner (🔴 any CRITICAL, 🟠 WARNINGs only, 🟢 clean), a header with file and line counts, base ← head, and the PR URL as a link, a 3–5 bullet summary, and the severity counts. When the workflow ran, add the findings audit from `REF/parallel-review.md` (every finding raised, valid or dismissed, with the reasoning) before the triage. Severity glyphs: 🔴 CRITICAL · 🟠 WARNING · 💡 SUGGESTION.

9. **Triage.** Present every finding numbered sequentially across severity groups, grouped by severity, each with glyph, bold summary, `file:line`, and the fix. Defaults: every finding → Fix, except those step 7 default-skips as already resolved. The user replies with exceptions only ("3: skip, 5: fix"), "all" for defaults, or free-text instructions per number.

   Prefer a Lavish artifact at `.lavish/review-<prNumber>.html` (`~/.claude/skills/chore-start-task/references/lavish.md`, skipping the playbooks, `--help` and `design`): one card per finding with a Fix/Skip choice and a single submit wired as `lavish.md` describes (the queued prompt lists each finding number with its Fix or Skip), plain inline CSS; annotations on a card are directives for that number. Without `lavish-axi`, use a single AskUserQuestion with the same content and grammar.

10. **Fix.** Apply the accepted fixes and run the tests for touched files (plus typecheck for TS). Leave lint and formatting to the lefthook commit hook; `yarn format` rewrites the whole tree. Close the Lavish session with a summary, and print what was applied and skipped.

11. **Ready for review.** Commit applied fixes with `Skill(hivebrite-engineering:github-commit)`. If the PR is a draft, `gh pr ready <pr>` before `git push` (the other order makes Buildkite skip the new head), unless the user skipped a CRITICAL: then ask first. Then `git push`.

## Tone

Direct, not diplomatic: "this will break when two requests race", not "consider a lock". Every finding states the consequence. Credit what the PR does well in the summary.

Don't flag what RuboCop, ESLint, or TypeScript catch, generated files (`yarn.lock`, `schema.rb`), or naming preferences with no real-world impact.
