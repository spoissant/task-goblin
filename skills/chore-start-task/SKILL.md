---
name: chore-start-task
description: Start a new task — fetches the task's Jira key, checks the ticket is assigned to the user, moves it to In Progress and into the active sprint, then delegates to jira-fix-bug for investigation and implementation from the current worktree. Use for /chore-start-task <taskId> or starting work on a not-yet-started task.
allowed-tools: "ToolSearch,Agent,Skill(hivebrite-engineering:jira-fix-bug),Skill(hivebrite-engineering:github-commit),Skill(hivebrite-engineering:github-pr),Bash(git:*),Bash(gh:*),Read,Write,Edit,Bash(lavish-axi:*),mcp__task-goblin__get_task,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__executeRead,mcp__plugin_hivebrite-engineering_atlassian__transitionJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__atlassianUserInfo,mcp__plugin_hivebrite-engineering_atlassian__searchJiraIssuesUsingJql,mcp__plugin_hivebrite-engineering_atlassian__editJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__createJiraIssue,mcp__task-goblin__sync_task,mcp__task-goblin__sync,mcp__task-goblin__update_task,mcp__task-goblin__start_session"
---

# Start Task

Numeric task ID argument (ask if missing). `get_task(id)` → `jiraKey`. Load the MCP tools this skill uses with one `ToolSearch` `select:` query naming them exactly.

## Assignee check

`getJiraIssue` the ticket and compare its assignee's accountId with the user's from `atlassianUserInfo`. If it is unassigned or assigned to someone else, stop: report the current assignee and change nothing.

## Jira to In Progress and active sprint

`jira-fix-bug` does not transition the ticket, so do it here. Check the current status; if it is already In Progress or beyond, skip. Otherwise list its transitions with the plugin's `executeRead` operation `listJiraIssueTransitions` (the name is known, no `discover` needed), pick the one whose target is "In Progress" and apply it with `transitionJiraIssue`. If no such transition exists from the current status, show the available ones and ask which to use rather than silently skipping.

Then put the ticket in the active sprint. Find it with `searchJiraIssuesUsingJql` `assignee = currentUser() AND sprint in openSprints()`, keeping only sprints in the Sprint field (`customfield_10003`) whose state is `active`; this picks the user's squad sprint, since a project can hold several. If none, retry with `project = <project key> AND sprint in openSprints()`. If several active sprints remain, ask which. If the ticket is already in it, skip; otherwise set it with `editJiraIssue` (`customfield_10003` = the sprint ID as a plain integer) or `transitionJiraIssue` `sprintId`. Jira sometimes files the ticket in another squad's sprint instead, with either call: read the Sprint field back (`searchJiraIssuesUsingJql` `key = <KEY>`) and, if it is wrong, set it again with the other call.

After any change, `sync_task(id)` once so task-goblin shows it.

## Delegate

`Skill(hivebrite-engineering:jira-fix-bug)` with the Jira key. It handles routing (quick win, plan review, no plan), implementation, and deploy/PR options. Pass it the five overrides below explicitly, and ask it to forward them to anything it sub-delegates to (`jira-plan-fix-bug` in particular), because its defaults assume a canonical clone. For a Story, Task or Sub-task, skip its bug-only outputs (the `jira-analyze-ticket` pre-step, the `fix_plan_created` label and the plan comment), and don't list skipped steps in reports.

**Worktree override.** This user works from git worktrees, not `$HIVEBRITE_DEV_DIR/<repo>`. The repository is the current working directory. Do not `cd` to a primary clone, do not require being on `sprint`/`main`/`master`, do not pull or clone. Check `git status -sb` first. A worktree created by Task Goblin is already on the task branch, `<fix|chore|feat>/<TICKET>` by issue type (Bug/Incident → `fix`, Story → `feat`, anything else → `chore`), created from `origin/<base>` (alumni_connect: `sprint`, front-monorepo: `main`); keep it and do not create another. Only if the worktree is detached, create that branch from HEAD. If the worktree has uncommitted changes, ask before any stash, reset, or branch switch.

**Other repos.** Work in another repository gets its own Jira sub-task under this ticket, assigned to the user (`createJiraIssue`; a sub-task takes its parent's sprint). Then `sync`, `get_task(jiraKey)` for the new task, `update_task` with its `repository`, and `start_session(taskId, "start-task")`. This session never creates worktrees or branches in other clones.

**Investigation in subagents.** This session lives through planning and implementation, so every file dump from the investigation is paid for again on each later turn. Delegate codebase exploration (root-cause search, git blame, finding callers and similar code) to `Explore` agents with `model: "sonnet"` launched in one message, one per independent area (backend and frontend, or each suspected code path), each returning the relevant `file:line` locations, current behaviour, and its root-cause hypothesis in about 40 lines. Read in full here only the files the fix will edit. Plan review, user questions, and implementation stay here.

**Lavish plan review.** Present the fix plan as a Lavish artifact at `.lavish/plan-<jiraKey>.html` (issue understanding, root cause, proposed solution, risks, confidence); it replaces `jira-plan-fix-bug`'s `bug-fix-plan-*.md`, so don't write one. Run `lavish-axi playbook plan` first, plus `diagram`/`comparison`/`code` if used. Each open decision states today's behaviour and what each option changes for the user. Open it, `lavish-axi poll` in the background, treat browser annotations as plan revisions (update the HTML, `--agent-reply` what changed), and start implementing only on approval from the browser or the terminal, then `lavish-axi end`. Without `lavish-axi`, use the skill's normal terminal plan.

**Finish override.** Once the implementation is done and tests pass, do not offer next steps (no deploy/PR/more-tests question). Always finish with, in order and without asking:
1. Run the checks CI most often fails on: in front-monorepo, when `__stories__` changed, `apps/playground/e2e/specs/storybook-coverage.spec.ts` (give a new story a playground specimen; a `storybook-coverage.json` entry only if the specimen can't show it); and any test that `jest.mock`s a module the diff changed or newly calls into.
2. Commit via `Skill(hivebrite-engineering:github-commit)`.
3. Push and create or update the PR via `Skill(hivebrite-engineering:github-pr)`, with its Step 4 quality suggestions skipped (no simplify/code-review prompt) and the plan summarised in an Investigation section. A new PR is always a draft. If a PR already exists, keep its draft state as it is.
4. Never deploy to staging here. That is `/chore-deploy-to-test-env`.

Lavish: use the globally installed `lavish-axi` binary, never `npx -y` even where Lavish's own help suggests it; only open HTML you generated; keep `.lavish/` in `.git/info/exclude`.
