# Posting a DRAFT GitHub review

A review posted without an `event` field stays PENDING: only its author sees it until they click "Submit review". Passing `event: COMMENT|APPROVE|REQUEST_CHANGES` submits immediately and defeats the purpose.

## Clean PR

No findings at all: still post a body-only pending review so the PR is distinguishable from one never reviewed. Body is exactly `👍 Reviewed — no issues found.`, nothing else. Print the review URL and stop.

## Payload

`commit_id` = the PR's `headRefOid` (`$SHA`). `comments` = one entry per finding with `path`, `line`, `side: "RIGHT"` (add `start_line` and `start_side` for multi-line ranges; `LEFT` only for deleted lines). No top-level `body`: the author wants per-line feedback, not a narrative.

Order comments CRITICAL → WARNING → SUGGESTION and number per severity in that order: `[CRITICAL 1]`, `[WARNING 1]`, `[WARNING 2]`… These tags are how the user refers to a comment afterwards, so never renumber within a review.

Each comment body starts with `**[SEVERITY N] TL;DR — …**`: one plain-language line about the observable effect, no symbol names or paths. Then a blank line, the mechanism and evidence, the fix, and the standard it violates when there is one. When the fix is an exact replacement of the anchored lines, add a fenced ```` ```suggestion ```` block so GitHub offers one-click commit. The block replaces exactly `start_line`…`line`, so anchor every line it changes; if that's not possible, describe the fix in prose.

Write for a reader who hasn't read the PR. Say where the problem shows up (page or screen, role, flag state), and for CRITICAL and WARNING how to see it. Spell out versions, domain terms and other repos on first use, and write cross-repo references as `owner/repo#N`: a bare `#N` links to this repo.

Findings without a precise anchor (architecture, cross-file test gaps) go on the most representative added line, with the other locations named in prose.

## Submit

Pipe the JSON on stdin through a quoted heredoc, so multi-line bodies need no shell escaping and nothing is written into the working tree: `gh api -X POST -H "Accept: application/vnd.github+json" /repos/<owner>/<repo>/pulls/<PR>/reviews --input -` fed by `<<'REVIEW_JSON'`.

GitHub rejects the whole review if any `line` is not in a diff hunk (usually a context line was targeted). Move that comment to the nearest added line and retry.

If the POST still fails with "one pending review", stop and say so: that draft is the user's, so never delete or overwrite it.

## Editing and submitting

REST can't edit a pending comment (`PATCH /pulls/comments/<id>` returns 404). Take the comment's `node_id` from `GET /repos/<owner>/<repo>/pulls/<PR>/reviews/<id>/comments`, then use GraphQL `updatePullRequestReviewComment(input:{pullRequestReviewCommentId, body})`, `deletePullRequestReviewComment(input:{id})`, or `addPullRequestReviewThread` for a new comment. Submit with `POST /repos/<owner>/<repo>/pulls/<PR>/reviews/<id>/events` and the `event` the user named; never submit without one.

## Output

Print the count posted, the review `html_url`, and an index of every comment as `<glyph> <SEVERITY N> — <path>:<line> — <TL;DR>` in payload order, followed by one line stating that the review is pending and comments can be discussed by tag. The chore is complete at this point: state the outcome, don't end on an instruction to submit.
