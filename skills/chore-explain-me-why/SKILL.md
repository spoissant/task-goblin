---
name: chore-explain-me-why
description: Explain a PR to its owner until they understand it — what changes and how it works, who benefits, why it is the right fix, the concepts it relies on, and the alternatives it beat — then answer follow-up questions. Read-only, it teaches and does not review. Use for /chore-explain-me-why <task ID or PR url>, "explain this PR", "help me understand this PR", or "why is this the right change".
allowed-tools: "ToolSearch,Bash(gh:*),Bash(git:*),Read,Grep,Glob,Skill(checkout-branch),mcp__task-goblin__get_task,mcp__task-goblin__update_task,mcp__plugin_hivebrite-engineering_atlassian__getJiraIssue,mcp__plugin_hivebrite-engineering_atlassian__getAccessibleAtlassianResources"
---

# Explain Me Why

The user ships AI-assisted changes outside their own expertise. This chore makes them understand the PR well enough to defend it to a reviewer and to make the next change like it themselves. Teach, don't review: hunting for findings is `/chore-code-review-my-pr`'s job.

The reader is an experienced engineer who is not an expert in the area the PR touches. Explain the domain, the codebase's conventions and the reasoning, not programming basics or what a plain read of the diff already shows.

## Input

A bare number is a Task Goblin task ID: `get_task(id)` → `prNumber`, `repository`, `headBranch`, `jiraKey`, `choreSkips`. Otherwise a PR URL (no task, so no skip flag), or nothing (current branch via `gh pr view`).

## 1. Gather

- `Skill(checkout-branch)` with the head branch; if it fails, stop and tell the user. This chore never edits the tree.
- The PR: `gh pr view <pr> --json title,body,url,author,baseRefName,headRefName,additions,deletions,files` and `gh pr diff <pr>`. Commit messages since the base often carry intent the PR body lacks.
- The ticket: `getAccessibleAtlassianResources` for the cloud id, then `getJiraIssue` with `responseContentFormat: "markdown"`. It is the main source for who asked, who is affected and why. Without a ticket, use the PR body and commits.
- The code around the diff: follow the path from the entry point (route, controller, job, consumer, component) to the change, read changed files in full where the diff alone hides behavior, and find where the codebase already does the same thing. That precedent is the best evidence for "why this way".
- The history: `git log` / `git blame` on the lines the PR replaces, to learn why the old code was the way it was.

## 2. Explain

Print one markdown document, sized to the PR: a few lines per section for a small fix, a ten-minute read for a large feature. Sections in this order, skipping any with nothing real to say:

1. **TL;DR**: the problem and the fix in two sentences, in terms of what people experience.
2. **Concepts you need**: each domain concept, codebase pattern or library feature the PR leans on that a non-expert would lack: what it is, how this codebase uses it, and another place to see it. It comes early so the sections below can use these terms freely.
3. **Who benefits**: which users or roles (members, network admins, super admins, developers, support, ops), where they meet the change, and what was wrong or missing for them before.
4. **What changes**: behavior before and after, walked along the request or data flow rather than file order, with `file:line` references. Mechanical changes (specs, locales, renames, generated files) get one line together.
5. **Why this is the right fix**: root cause versus symptom, why at this layer, how it follows existing patterns (cite them), and which constraints it respects: tenancy, permissions, performance, backwards compatibility, feature flags, migrations.
6. **Alternatives weighed**: two or three realistic other approaches and why this one wins, then the tradeoffs and risks it accepts and what it deliberately leaves out. If an alternative is arguably better, say so.

Keep what the code or ticket shows separate from what you infer, and mark inferences. Never invent a business reason: "the ticket doesn't say why" is a useful answer, a made-up justification defeats the chore.

If the explanation runs into something that doesn't hold up (the code contradicts the ticket, a change has no reason you can find, a likely bug), add a short **Doesn't add up** section at the end. Understanding the PR includes knowing where it is weak.

## 3. Skip flag

With a task ID, right after printing: `update_task(id, choreSkips)` with `"explain-me-why": true` merged into the existing keys (the field replaces the whole map). Do it before the Q&A, which may never formally end.

## 4. Q&A

Close with one line inviting follow-up questions, then answer them from the code with `file:line` references. Go as deep as asked: trace another path, explain a library, compare with how another module does it. Stay read-only; if the discussion surfaces a change worth making, name the chore that would make it.
