# Hermetic tests in the plan (alumni_connect)

Hermetic specs live in hivetests (`*.hermetic.spec.ts`) and run against alumni_connect's compose stack. A hivetests branch named exactly like this task's branch is this PR's suite: alumni_connect's build runs it instead of `main`, and the two PRs merge together.

## Deciding

Most changes need none: a backend-only change, a refactor, a fix that rspec or jest already pins, a copy or style tweak. Then the section is one line saying why, with no coverage search. A spec has to earn its place: browser specs are slow, and the owning squad maintains them.

When the change does alter behaviour visible through the UI, read the rules from the source: `git -C ~/Code/hivebrite/hivetests fetch origin main`, then `git show origin/main:docs/pr-review.md` §0, and this worktree's `docs/testing/HERMETIC_PLAYWRIGHT.md` ("What a hermetic spec cannot do", "Adding a scenario"). Fold into the investigation's `Explore` agents a map of current coverage for the feature: the specs on hivetests `origin/main` (`git grep` / `git show`), the seeds in `lib/hermetic_e2e/seeds/`, and what each asserts.

Sort each behaviour the change adds or alters into one bucket:

- **New hermetic**: lives in alumni_connect, visible through the UI (permissions, validation, rendering, business rules, flag combinations, an edge case), and not already proven by this PR's rspec/jest at a lower level.
- **Update**: an existing spec or seed the change makes wrong.
- **E2E only**: crosses a deployable or needs real infrastructure. Listed only: QA writes its Qase case first.
- **Not worth a browser test**: one line on why.

## The plan section

Hermetic tests: each scenario's bucket, title from the user's perspective, roles, flags, target spec file, and its seed: an existing one with which options, or a new one with its name, keyword options and the fixture it returns. The seed interface is the contract between the two sessions, so it is settled here. "None needed" is a valid section. Seeds and any missing `data-testid` are this session's implementation work.

## After approval

Nothing to write: skip. Otherwise, per the Other repos override, with these differences:

- The sub-task's summary is `[hivetests] Hermetic specs for <ticket summary>`, and its description is the approved Hermetic tests section plus this task's branch name.
- `update_task` with `repository: "hivetests"`. Task Goblin gives the sub-task's worktree this task's branch name.
- Move the sub-task to In Progress (the same transition lookup as this ticket), so it is not offered `/chore-start-task`.
- `start_session(subtaskId, prompt: "/chore-hermetic-tests <subtaskId>")`. Start it right away, so it writes the specs in parallel with this session.
