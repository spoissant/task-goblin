# Report format

Glyphs: type 👏 praise · ❓ question · 💡 suggestion · ❌ issue · 🔧 nitpick; source 💬 review thread · 🗨️ PR-level comment; resolve ✅ will resolve · ⏸️ keep open.

Open with a one-line banner (`💬 3 unresolved · 2 issues · 1 question`), then:

- **Decisions for you**, only when there are any: one line each, with your recommendation.
- **Summary**: PR, task (`id — jiraKey title`), open-item count by source, count by type.
- **Table**: type glyph, source glyph, number, `file:line`, author, type, resolve glyph. This is the scannable overview.
- **Details**, only for items needing analysis or a reply draft (skip pure praise): quoted comment, analysis, planned action as a checklist, draft reply, resolve decision with a reason when ⏸️. Use a fenced `diff` block when showing the exact change.
- **Execution plan**: code changes by `file:line`, commit and push, PR description update if any, follow-up cards, replies to post (one per addressed GitHub item, anchored `@author on file:line` in the report only, never in the reply text).

In the Lavish artifact, run `lavish-axi playbook table` (and `code` if you show diffs) before writing HTML. Apply browser annotations to the plan, update the HTML (Lavish live-reloads), answer with `--agent-reply`, and `lavish-axi end` after execution.
