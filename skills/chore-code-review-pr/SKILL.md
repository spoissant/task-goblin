---
name: chore-code-review-pr
description: Harsh, comprehensive code review of a colleague's GitHub PR against Hivebrite project standards, posted as a DRAFT (pending) GitHub review for you to polish and submit, or auto-approved when it finds nothing at all. Reads the PR from git objects without checking it out, so several reviews can run in parallel in the same folder. For your own PRs use /chore-code-review-my-pr. Use when reviewing someone else's PR or running /chore-code-review-pr <PR url or number>.
allowed-tools: "Workflow,Bash(gh:*),Bash(git fetch:*),Bash(git show:*),Bash(git grep:*),Bash(git ls-tree:*),Bash(git cat-file:*),Bash(git remote:*),Read"
---

# Harsh Review (colleague PR)

Find real problems: bugs, security holes, architecture violations, design-system misuse, missing translations, reinvented wheels, performance landmines, testing gaps. Say what will go wrong in production and how to fix it.

This often runs unattended in a background session, next to other reviews and to someone's work in progress, all in the same folder. It never asks questions and never touches the working tree.

## Input

A PR URL or number. If `gh api user --jq .login` equals the PR author, stop and point to `/chore-code-review-my-pr`.

## Reading code

The working tree holds whatever branch someone else has checked out, so it is never a source for PR code. Do not checkout, switch, stash, reset, or edit files.

- Check `git remote get-url origin` matches the PR's repository; stop if it doesn't.
- `git fetch --no-write-fetch-head origin pull/<N>/head`, then `SHA` = the PR's `headRefOid`. Other reviews may fetch at the same time; retry once on a lock error.
- Read files with `git show "${SHA}:<path>"`, search with `git grep -n <pattern> "$SHA" -- <paths>`, list with `git ls-tree -r --name-only "$SHA" -- <dir>`. This covers the standards docs too. Keep the quotes and braces: zsh reads a bare `$SHA:` as a modifier and mangles the path.

## Workflow

1. **Fetch context.** `gh pr view <PR> --json number,title,body,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,url,files` (`files` gives per-file line counts; `gh pr diff` has no `--stat`), then the full `gh pr diff <PR>` unless step 2 hands the review to the workflow. Also fetch existing review discussion with GraphQL (`reviewThreads` with `isResolved`, `isOutdated`, comments' `author`, `path`, `line`, `body`; plus PR-level `comments`). REST does not expose thread resolution state, which is the signal for "already dismissed by the owner". If you already have a PENDING review on the PR (`gh api repos/<owner>/<repo>/pulls/<PR>/reviews --jq '.[]|select(.state=="PENDING")|.html_url'`), stop and say so: GitHub allows one per user and it holds the user's draft. Then fetch the PR objects as above.

2. **Scope.** Size the review by lines changed and note which domains are touched: Ruby backend, React/TS frontend, specs, migrations, config, feature flags. Skip pure locale, asset, and generated files. Above roughly 300 changed lines, run steps 3–6 through the `review-pr` workflow as described in `references/parallel-review.md` (mode `git-objects`), then resume at step 6's de-dup with its verified findings.

3. **Load standards** listed in `references/standards.md` for the paths in the diff.

4. **Read critical files in full**, not just the diff: operations, models, controllers, anything security-sensitive. N+1s, tenancy scoping, Railway chains, and rescue contracts are only visible with the surrounding class. Diff is enough for specs, locales, schema, and generated files.

5. **Reinventing-the-wheel audit.** For each non-trivial new hook, component, utility, service, or concern, search for an existing equivalent before flagging. Read `references/reinvention.md` for where to look and the known patterns. Flag only clear equivalents.

6. **Review.** One coherent pass organised by the categories in `references/checklist.md`, which also defines CRITICAL / WARNING / SUGGESTION. Each finding: bold one-line summary, real-world consequence (who hits it, where, how to see it), `file:line`, concrete fix.

   De-dup against step 1 first. Drop findings a human already made or that were raised and dismissed (resolved thread, or author rejected and nobody reopened) unless you have a concrete new reason, and say so. Where you add a genuinely new angle to an existing thread, lead with "Building on X's comment" and link it. Ignore `isOutdated` threads as a dup source.

   Write logins without `@` in anything you post: `@claude` in a submitted comment starts the Claude workflow on the author's PR.

7. **Post a DRAFT review.** Every finding becomes a line-anchored comment in one PENDING review, so the user can polish and submit on GitHub. Only its author sees a draft, so no confirmation is needed. A PR with no findings at all is approved instead, on the user's standing authorization. Read `references/draft-review.md` for the payload rules, the clean-PR case, and recovery when GitHub rejects an anchor.

8. **Output.** Print a one-line verdict banner (🔴 any CRITICAL, 🟠 WARNINGs only, 🟡 SUGGESTIONs only, 🟢 clean and approved), a header with author, file and line counts, base ← head, and the PR URL as a link, a 3–5 bullet summary, the severity counts, then the index from `references/draft-review.md`.

   Severity glyphs everywhere findings appear: 🔴 CRITICAL · 🟠 WARNING · 💡 SUGGESTION.

## After the draft

Follow-ups edit the same draft, keeping tags stable. If a posted comment turns out wrong or unverified, fix or delete it yourself rather than asking the user to. Submitting a draft (APPROVE, COMMENT, REQUEST_CHANGES) makes the review public: do it only when the user names the event in this session. The one exception is the clean-PR auto-approval. API details are in `references/draft-review.md`.

## Tone

Direct, not diplomatic: "this will break when two requests race", not "consider a lock". Cite the standard file when one applies, since GitHub readers don't have step 3's context. Every finding states the consequence. Credit what the PR does well in the summary.

Don't flag what RuboCop, ESLint, or TypeScript catch (formatting, import order, quote style), generated files (`yarn.lock`, `schema.rb`), or naming preferences with no real-world impact.
