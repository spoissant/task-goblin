# Parallel review

When the calling skill's scope step says so, the review runs through the `review-pr` workflow (`task-goblin/workflows/review-pr.js`, linked as `~/.claude/workflows/review-pr.js`), so the full diff, the standards docs, and the search results stay out of the calling context. The calling skill keeps the PR metadata with its file list and the existing review discussion; it never reads the full diff itself in this mode.

## Calling it

One `Workflow` call, then wait for its completion notification. Never call it twice and never guess its result.

```
Workflow({ name: "review-pr", args: {
  pr: { number, repo: "owner/repo", base, head, sha: headRefOid, url, author },
  mode: "git-objects" | "worktree",
  refDir: "<absolute path of this references/ folder, $HOME expanded>",
  files: [{ path, additions, deletions }, …]   // gh pr view --json files
} })
```

`mode` is `git-objects` for a colleague's PR (the agents read with `git show`/`git grep` on the head SHA, nothing is checked out) and `worktree` for your own (the branch is checked out). Every agent is read-only.

## What it does

1. **Slices** the files by type: Ruby to a Backend reviewer, TypeScript/JavaScript/CSS to a Frontend reviewer, the rest to whichever exists; locale, asset and generated files to no one. A slice above about 60 files splits by its first two path segments. One reviewer agent per slice, told the PR, how to read code, its exact file list, `standards.md`, the `checklist.md` sections for its slice, and the Tone section. Plus one Explore agent for the reinventing-the-wheel audit over `reinvention.md`.
2. **Dedups** by location, keeping the more severe or more precise finding.
3. **Verifies** every finding, SUGGESTIONs included, with two independent agents: *evidence* re-reads the cited code and tries to refute the claim (and corrects a wrong anchor line); *impact* applies the severity test from `checklist.md`, and for a SUGGESTION asks whether the author would act on it. Refuted or not worth a comment: dropped. Otherwise the severity is the lower of the two opinions.

## What it returns

```
{
  findings: [{ severity, category, path, line, endLine?, summary, consequence, fix, standard?, replacement?, verification, reported: { severity, line }, checks: { evidence, impact } }],
  praise: [string],            // what the slices do well, for the summary
  dropped: [{ …finding, reported, checks, reason }],   // refuted, or not worth a comment
  merged: [{ …finding, reason }],                      // folded into another finding at the same location
  slices: [{ name, files }],
  skipped: [path],             // locale, asset, generated
  failedSlices: [name]         // an agent died: these files were not reviewed
}
```

`findings` is sorted CRITICAL → WARNING → SUGGESTION and already verified: carry on with the calling skill's review step from the de-dup against existing discussion onward, as if the findings came from a single pass, without re-verifying. Say in the summary which `failedSlices` went unreviewed. `dropped` and `merged` stay out of anything posted to GitHub, but they are not hidden from the user: they go in the audit below.

## Findings audit

While the workflow is being validated, the printed report ends with an audit of everything the reviewers raised, so the user can compare what was found with what was submitted. It is terminal output only and never part of the posted review. One table row per entry of `findings`, `dropped` and `merged`, most severe first (by `reported.severity`):

| # | Reported | Location | Finding | Status | Reasoning |
|---|----------|----------|---------|--------|-----------|

- **Reported**: `reported.severity`, with the glyph.
- **Location**: `path:line` as reported (`reported.line`).
- **Status**: `valid` for `findings`, `dismissed` for `dropped` and `merged`. A `valid` row shows the final severity or line when they differ ("valid, now WARNING", "valid, line 45"), and "valid, unverified" when `verification` says a verifier died. Add "(posted)" or "(left out by the de-dup against existing discussion)" once that step has run, so the table also shows what actually went into the draft.
- **Reasoning**: for `valid`, the evidence checker's and the impact checker's `checks` in a few words each. For `dismissed`, the `reason` (refuted, not worth a comment, merged) with the checker's wording.

Under the table, one line of counts: raised, merged, refuted, not worth a comment, valid, posted.
