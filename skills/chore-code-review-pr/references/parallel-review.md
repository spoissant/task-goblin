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
3. **Verifies** every CRITICAL and WARNING with two independent agents: *evidence* re-reads the cited code and tries to refute the claim (and corrects a wrong anchor line); *impact* applies the severity test from `checklist.md`. Refuted or without a real consequence: dropped. Otherwise the severity is the lower of the two opinions. SUGGESTIONs are not verified.

## What it returns

```
{
  findings: [{ severity, category, path, line, endLine?, summary, consequence, fix, standard?, replacement?, verification }],
  praise: [string],            // what the slices do well, for the summary
  dropped: [{ …finding, reason }],
  slices: [{ name, files }],
  skipped: [path],             // locale, asset, generated
  failedSlices: [name]         // an agent died: these files were not reviewed
}
```

`findings` is sorted CRITICAL → WARNING → SUGGESTION and already verified: carry on with the calling skill's review step from the de-dup against existing discussion onward, as if the findings came from a single pass, without re-verifying. Say in the summary which `failedSlices` went unreviewed, and leave `dropped` out of what gets posted.
