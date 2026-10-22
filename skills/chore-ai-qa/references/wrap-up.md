# Wrap up a task that passed QA

In order: bug metadata, then Jira. Leave the PR as a draft: `/chore-code-review-my-pr` is next and marks it ready.

Bug metadata: if the ticket is a Bug and Tech root cause (`customfield_11150`), Process root cause (`customfield_12217`) or Preventive measures (`customfield_12218`) is empty, run `Skill(hivebrite-engineering:jira-postmortem-bug)` on it before transitioning. Do not ask the user anything: pick the most likely value for every empty field yourself, whatever its confidence (a wrong pick costs almost nothing), apply them as if approved, and skip the regression source if it cannot be found. Show the applied values in the QA report.

Jira: skip if the ticket is already in Code Review or beyond. Otherwise list its transitions with the plugin's `executeRead` operation `listJiraIssueTransitions` (the name is known, no `discover` needed), pick the one whose target is "Code Review" and apply it with `transitionJiraIssue`. If no such transition exists from the current status, show the available ones and ask which to use rather than silently skipping.
