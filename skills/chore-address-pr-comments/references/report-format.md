# Report format

The user approves or amends the plan from this report alone, without opening the PR, so every item says what the reviewer said before what you make of it.

Glyphs: type 👏 praise · ❓ question · 💡 suggestion · ❌ issue · 🔧 nitpick; source 💬 review thread · 🗨️ PR-level comment; resolve ✅ will resolve · ⏸️ keep open.

Open with a one-line banner (`💬 3 unresolved · 2 issues · 1 question`), then:

- **Decisions for you**, only when there are any: one line each, with your recommendation.
- **Summary**: PR, task (`id — jiraKey title`), open-item count by source, count by type.
- **Table**: type glyph, source glyph, number linked to the comment's `url`, `file:line`, author, the reviewer's point in one short sentence (what they ask or flag, not your verdict), resolve glyph. A comment with several points gets one row per point (`4a`, `4b`).
- **Details**, for every item except pure praise, declined points included. Each opens with what the reviewer said: the comment quoted, verbatim when short, and when long, every point with its reasoning in the reviewer's terms. For a review thread, follow it with the few lines of code it is anchored on. Then your verdict and analysis, the planned action as a checklist, the draft reply, and the resolve decision with a reason when ⏸️. Use a fenced `diff` block when showing the exact change.
- **Execution plan**: code changes by `file:line`, commit and push, PR description update if any, follow-up cards, replies to post (one per addressed GitHub item, anchored `@author on file:line` in the report only, never in the reply text).
