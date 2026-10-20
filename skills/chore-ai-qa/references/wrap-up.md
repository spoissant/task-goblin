# Wrap up a task that passed QA

In order: bug metadata, Jira, then `sync_task(id)`. Leave the PR as a draft: `/chore-code-review-my-pr` is next and marks it ready.

Bug metadata: if the ticket is a Bug and Tech root cause (`customfield_11150`), Process root cause (`customfield_12217`) or Preventive measures (`customfield_12218`) is empty, run `Skill(hivebrite-engineering:jira-postmortem-bug)` on it (interactive, so it asks only for what it cannot deduce) before transitioning.

Jira: skip if the ticket is already in Code Review or beyond. Otherwise load `select:mcp__claude_ai_Atlassian__getTransitionsForJiraIssue` (a keyword search does not find it; the plugin server lacks it), pick the transition whose target is "Code Review", and apply it with `transitionJiraIssue`. If no such transition exists from the current status, show the available ones and ask which to use rather than silently skipping.
