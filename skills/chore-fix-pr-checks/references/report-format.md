# Report format

Glyphs per check: ❌ Our Fault · 🟠 Likely Ours · ⚠️ Unclear · ⏭️ External / Flaky. Verdict banner: 🔴 NO-GO (code fix needed) · 🟡 MIXED · 🟢 GO (purely external, re-run) · 🟣 BLOCKED BY SPRINT (base fails the same step).

Open with the one-line verdict banner (`🔴 NO-GO · 3 failed checks · 2 ours · 1 flaky`), then:

- **Summary**: PR, head SHA, failed-check count, verdict.
- **Failed checks table**: glyph, check name, classification, suggested action (`Fix file:line`, `Re-run build`, …).
- **Details** only for checks that need more than a table row (skip clean externals): the key log excerpt in a fenced `log` or `diff` block (the one place the terminal renders colour), the evidence for the classification (file overlap, log analysis, local run), and an action checklist.
- **Our changed files** and **commits**.
- **Fixes**, only when that step ran: what changed, the local test run, and the pushed commit.
- **Base branch merge**, only when that step ran: merged and pushed (CI re-running), merged locally and not pushed (failed jobs retried instead), conflicted, or already up to date.
- **Re-runs and prior attempts**, only on a repeat: which checks were re-run individually, how many times this chore already ran for the task, and the base build checked. For BLOCKED BY SPRINT, the failing base build and the base commits that touched the referenced files.
- **Next steps**, prioritised.
