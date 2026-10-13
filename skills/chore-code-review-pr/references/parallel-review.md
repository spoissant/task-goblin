# Parallel review

When the calling skill's scope step says so, the review runs in subagents so the full diff, the standards docs, and the search results stay out of the calling context. The calling skill keeps the PR metadata with its file list and the existing review discussion; it never reads the full diff itself in this mode.

## Agents

Launch them in one message, only for the slices the PR touches:

| Agent | Type | Slice | Checklist sections |
|---|---|---|---|
| Backend | `general-purpose` | Ruby under `app/`, `gems/`, `lib/`, `config/`, `db/migrate/`, and their `spec/` files | 2, 3, 5 Ruby, 6, 7, 8 |
| Frontend | `general-purpose` | `front/**` including its tests and stories | 2, 3, 4, 5 TS/React and i18n, 7, 8 |
| Reinvention | `Explore` | every non-trivial new hook, component, utility, service, or concern in the diff | `reinvention.md` |

A slice with more than about 60 files splits again by top-level domain directory, one agent each. Pure locale, asset, and generated files go to no agent.

## What each agent is told

- PR number, `owner/repo`, base ← head, `headRefOid`, and its exact list of files.
- How to read code, copied from the calling skill: for a colleague PR the working tree is someone else's, so only `git show "${SHA}:<path>"`, `git grep -n <pattern> "$SHA" -- <paths>`, `git ls-tree`, and `gh pr diff <PR>`, never checkout or edits, and no `git fetch` (the caller already fetched); for your own PR the working tree is the PR branch. Every agent is read-only.
- Reviewers: read `references/standards.md` for their paths and load those docs, read the critical files of their slice in full (operations, models, controllers, anything security-sensitive), apply the listed sections of `references/checklist.md` with its severity definitions, and follow the calling skill's Tone section.
- Reinvention: the list of new constructs with their paths, and `references/reinvention.md`. Report only clear existing equivalents, as WARNINGs.

All reference paths are absolute under `~/.claude/skills/chore-code-review-pr/`.

## What each agent returns

Findings only, no prose review: severity, checklist category, `path`, `line` (in the head commit, on an added line whenever one fits), one-line summary, real-world consequence, concrete fix, the standard violated if any, and an exact replacement for the anchored lines when the fix is one. Reviewers add up to two bullets on what the slice does well. No code excerpts beyond the replacement.

## Merging

1. Drop duplicates across agents (same location and same problem); keep the more precise one.
2. Re-read the cited lines of every CRITICAL and WARNING yourself and drop or downgrade it if the evidence or the severity test in `checklist.md` does not hold. A false CRITICAL costs more than a missed SUGGESTION.
3. Carry on with the calling skill's review step from the de-dup against existing discussion onward, as if the findings came from a single pass.
