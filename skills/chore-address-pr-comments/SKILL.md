---
name: chore-address-pr-comments
description: Work through a PR's unresolved review threads and PR-level comments as one worklist, then post replies and resolve threads. Accepts a task ID, auto-detects from the branch, or takes a PR URL. Use when asked to address PR comments or review feedback.
allowed-tools: "Bash(gh:*),Bash(python*),Bash(git:*),Bash(lavish-axi:*),Read,Grep,Glob,Edit,Write,ToolSearch,Skill(checkout-branch),Skill(hivebrite-engineering:github-commit),Skill(hivebrite-engineering:jira-create-ticket),mcp__task-goblin__get_task"
---

# Address PR Comments

One worklist from two sources:

| Source | From | Closed by |
|---|---|---|
| Inline review threads | GitHub | reply + resolve |
| PR-level comments | GitHub | reply (cannot be resolved) |

## Resolve the task

In order: numeric argument → `get_task(id)`; otherwise `get_task(branch: <current branch>)`; otherwise ask for a PR URL. From the task take `prNumber`, `repo`, and `headBranch`. No PR: nothing to address, say so and stop.

`Skill(checkout-branch)` with `headBranch`; if it fails, stop and tell the user.

## Fetch

```bash
python3 {baseDir}/scripts/fetch_comments.py --owner <owner> --repo <repo> --pr <n>
```

The script's docstring describes its output (`threads` with `id` for resolving and `restId` for replying, `issueComments`, noise bots filtered). Merge them into a single list. A structured review posted as one issue comment contains several distinct suggestions; treat each as its own item.

## Analyse

Read the code each item points at: the thread's `path` with a few lines of context, and the files an issue comment mentions.

Classify each item (praise, question, suggestion, issue, nitpick) and decide validity, scope, impact, the change to make, the reply, and whether it gets resolved.

- Resolve every thread you reply to, pushback and answered questions included, and any thread the user already answered. Keep a thread open only while its fix is pending (blocked on another PR or release, or deferred to a follow-up card) or when your reply asks the reviewer something.
- Valid but out of scope: plan a follow-up Jira sub-task under the task's parent epic (`jira-create-ticket`, same sprint and assignee), linked in the reply, thread kept open.
- Bot reviews (claude[bot] and similar): one short PR-level reply when a point led to a change or was declined; none when nothing was actionable.
- A change that makes the PR description wrong includes updating it.

## Report and confirm

Produce the report described in `references/report-format.md`, preferably as a Lavish artifact at `.lavish/pr-comments-<prNumber>.html` (`~/.claude/skills/chore-start-task/references/lavish.md`; playbook `table`, plus `code` if you show diffs) so the user can annotate items; otherwise print it. List the decisions that need the user first. Keep the one-line banner in the terminal either way.

One confirmation covers the whole plan: code changes, commit, push (local commits already on the branch included), PR description, follow-up cards, replies and resolves. Don't ask optional side questions; take the defaults above. Wait for that confirmation ("go", "execute the plan", or an equivalent from the browser) before posting or resolving anything. If the invocation already says what to do, or the only items are threads the user already answered, that counts as confirmation. If the user amends the plan, apply the amendment and execute; ask again only if it opens a new decision.

## Execute

Make the code changes, commit with `Skill(hivebrite-engineering:github-commit)` and push to `headBranch`; name any pre-existing local commits that went up. Then per item: reply, then resolve. Commands are in `references/github-api.md`. Report what was posted and resolved. Anything the user must act on (an auth link, a command) goes in the final message.

Replies are short and human: thank praise (or just resolve a "+1"), answer questions directly, say what you changed for accepted feedback, explain your reasoning respectfully when you keep the current approach. Correctness and security over style.

NEVER write `@claude` or any `@login` in a reply or comment: it queues the repo's `claude-interactive` workflow, and editing the comment doesn't stop the run.
