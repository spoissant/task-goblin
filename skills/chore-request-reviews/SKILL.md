---
name: chore-request-reviews
description: Request code reviews for one or more PRs via Slack. Resolves target channels from the repo default plus requested reviewer teams, composes the message with the PR's size and FE/BE split, sends it after approval. Use for /chore-request-reviews <taskId> [<taskId>…] or "request reviews for task".
allowed-tools: "ToolSearch,AskUserQuestion,Bash(gh:*),Skill(hivebrite-engineering:request-pr-review),mcp__task-goblin__get_task,mcp__task-goblin__list_team_channels"
---

# Request Reviews

Accepts one or more numeric task IDs (ask if none). Tasks are independent and touch no working tree, so gather data for all tasks first (in parallel where convenient), then send per channel; a failure on one task is recorded and the batch continues. Finish with one line per task: sent to which channels, skipped why, or failed why.

## Steps

1. `get_task(id)` → `prNumber`, `repository` (owner/repo and its `slackChannel`), `jiraKey`. No PR: skip.

2. Target channels: the repository's `slackChannel`, plus the channel mapped to each team in `gh api repos/<o>/<r>/pulls/<pr>/requested_reviewers --jq '[.teams[].slug]'`. The slug → channel map comes from `list_team_channels` (fetch once per batch). Deduplicate. No channels: warn, move on. Fetch the PR title with `gh pr view <pr> -R <o>/<r> --json title`; the link uses it, not the task title.

3. Size and split from step 1's `get_task`: `changedFiles`, `additions`, `deletions`, and `changesByCategory`, a JSON string with `frontend`/`backend`/`other` buckets, each counting `files`, `additions` and `deletions`. The size goes by lines changed (`additions` + `deletions`): up to 200 small, up to 800 medium, above that large. A bucket's percent is its share of the buckets' files, which cover at most the PR's first 100.

   Build the PR line as `{emoji} {label}  ·  {suffix}  ·  <{url}|{repo} — {title}>`, separator two spaces, middle dot, two spaces, metadata before the link so the reviewer sees size and scope first. Suffix: `{changedFiles} files ({pct}% FE / {pct}% BE / {pct}% OT) · +{additions} / -{deletions}`, omitting buckets at 0%. Size to emoji and label: small `:white_circle:` Small, medium `:large_yellow_circle:` Medium, large `:red_circle:` Large. Green is avoided on purpose because it reads as "approved" in review tools.

   If `changesByCategory` is null or the PR reports zero files, skip the suffix and the colour override and let the sub-skill use its defaults.

4. After all tasks are resolved, group PR lines by channel: one message per channel, lines ordered small → large. Open each message with one short, friendly sentence, then the PR lines below it, replacing the sub-skill's header ("PRs ready for review:" for several PRs). Write a fresh greeting every time, never reusing the wording or emoji of an earlier message, so it reads like a person typed it: a casual hello, a request for reviews on this PR / these PRs, and a light "when you have a minute" type of touch, plus an emoji you pick each time. Seed: "Hello, need some reviews on this PR when you have a minute 🙏". For each channel, `Skill(hivebrite-engineering:request-pr-review)` with the channel, the PR links, the greeting line to use as the header, and, when step 3 had the stats, the instruction to use these exact emoji and PR lines instead of its score formula.

   Show every composed message together and get explicit approval through one AskUserQuestion before anything is sent. Never send without that approval: Slack messages cannot be unsent.
