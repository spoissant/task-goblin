---
name: checkout-branch
description: Safely switch to a git branch. Use when user says "checkout branch", "/checkout-branch <name>", or wants to switch branches.
allowed-tools: "Bash(git:*),AskUserQuestion"
---

# Checkout Branch

Switch to the branch given as argument (ask if missing) without losing work.

This skill usually runs from inside another chore skill when the context is already large, so every round-trip is expensive. The flow below finishes in one Bash call on the common paths; keep it that way.

1. Probe once with `git status --porcelain=v1 --branch`. The `##` line gives the current branch and any `[ahead N]`; the remaining lines are dirty files. Without an upstream the unpushed count is unavailable, so skip that check.
2. Already on the target branch: say so and stop. This is the most frequent case in a worktree workflow.
3. Clean tree and nothing ahead: `git checkout <branch>` right away.
4. Otherwise ask once, showing the dirty files and the ahead count together, with the options that apply: discard changes and switch (`git checkout . && git clean -fd && git checkout <branch>`, only when dirty), switch keeping changes (only when clean but ahead), stop. Unpushed commits stay on their branch across a checkout; the warning is a push reminder, not a data-loss risk.
5. Report the result. If checkout fails, report the error and stop.
