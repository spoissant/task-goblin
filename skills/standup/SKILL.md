---
name: standup
description: Build a standup summary of the work done since the last standup, from Task Goblin's AI sessions and the board. Use for /standup [since], "prep my standup", or "what did I do yesterday".
allowed-tools: "Bash(date:*),ToolSearch,mcp__task-goblin__list_sessions,mcp__task-goblin__get_task"
---

# Standup

Prints the update to post in Slack. Read-only: it sends nothing.

## Steps

1. **Window.** Standup is at 10:00 local time. By default the window starts at 10:00 on the previous workday, so Monday reaches back to Friday. An argument ("since Thursday", a date, a time) overrides that. Use `date` for the current local time and offset, and pass `since` as ISO 8601 with that offset.

2. **Sessions.** Call `list_sessions(since)` and page with `offset` until you have `total`. A session's `result` is its one-line outcome. `detail` and `needs` say where it stopped and what it is waiting on. `error` is a failure on Task Goblin's side. Skip sessions that are still `queued` or `preparing`.

3. **Group.** Group sessions by `taskId`. Sessions with `taskId` null are PR reviews of teammates' work, keyed by `prUrl`. For each task, `get_task` (the server re-syncs the board every 5 minutes) gives the Jira key, title, type, epic, status, PR state, draft flag, checks, approvals, unresolved comments, conflicts, and the on-ice and high-priority flags.

4. **Write.** The final message is the update alone, in Markdown with no preamble, heading or sign-off: the Standup page renders it and its Slack button drafts it as is in the squad's async-update thread. Match the user's own Slack updates:
   - Group by project, not by status. Each group opens with its name in bold on a line of its own: a short nickname of one or two words for tasks that share an `epicKey`, taken from what their titles have in common; **Bugfixing** for bugs outside a project; **Other** for the rest; **Reviews** last, for teammates' PRs.
   - One bullet per task: `- <status> - [<Jira title>](<Jira key>)`, the link target being the bare key (Task Goblin turns it into the Jira URL). A task without a Jira key links its PR title to the PR. Several tasks of one project in the same status can share a bullet that lists their short names. A review is `- :eyes: - [<repo>#<N>](<prUrl>)`.
   - Status is a Slack emoji: `:merged:` PR merged; `:white_check_mark:` done without a merge (validated, cannot reproduce, closed as duplicate); `:qa:` ready for test or waiting on QA; `:progress_bar:` anything still moving, review included. Order each group's bullets in that order.
   - Add ` -> <note>` only when the status alone misleads: cannot reproduce, closed as a duplicate of another ticket, already fixed and sent to QA, blocked on failing checks, conflicts, unanswered comments or a session's `needs`, on ice with its reason. A few plain words, no chore names, no PR numbers.

   Don't pad with filler or invent work that the sessions don't show.
