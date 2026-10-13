---
name: standup
description: Build a standup summary of what I worked on since the last standup, from Task Goblin's AI sessions plus the live board state. Use for /standup [since], "prep my standup", or "what did I do yesterday".
allowed-tools: "Bash(date:*),ToolSearch,mcp__task-goblin__sync,mcp__task-goblin__list_sessions,mcp__task-goblin__get_task"
---

# Standup

Prints a summary to paste into the meeting or Slack. Read-only: it sends nothing.

## Steps

1. **Window.** Standup is at 10:00 local time. By default the window starts at 10:00 on the previous workday, so Monday reaches back to Friday. An argument ("since Thursday", a date, a time) overrides that. Use `date` for the current local time and offset, and pass `since` as ISO 8601 with that offset.

2. **Fresh state.** Run `sync` so PR and Jira fields are current. If it fails, keep going and say the board state may be stale.

3. **Sessions.** Call `list_sessions(since)` and page with `offset` until you have `total`. A session's `result` is its one-line outcome. `detail` and `needs` say where it stopped and what it is waiting on. `error` is a failure on Task Goblin's side. Skip sessions that are still `queued` or `preparing`.

4. **Group.** Group sessions by `taskId`. Sessions with `taskId` null are PR reviews of teammates' work, keyed by `prUrl`: list them together as one "Reviewed" line. For each task, `get_task` gives the Jira key, title, status, PR state, draft flag, checks, approvals, unresolved comments, conflicts, and the on-ice and high-priority flags.

5. **Write.** Keep one line per task: Jira key, short title, then what changed in plain words, merged from all its sessions without listing chore names. Sections:
   - **Done**: PR merged, or ticket moved to a done status in the window.
   - **In progress**: everything else touched, with where it stands now (in review with N approvals, deployed to a test env, waiting on QA).
   - **Blocked / waiting**: failing checks, conflicts, unanswered comments, a session in `blocked` with its `needs`, a task on ice with its reason.
   - **Reviewed**: teammates' PRs reviewed, if any.

   Leave out empty sections. Don't pad with filler or invent work that the sessions don't show. Close with one line saying that sessions run outside Task Goblin are not covered.
