# front-monorepo upstream

An alpha is published from a local checkout: the `version-alpha` Nx target builds the package, picks the next `<version>-<user>-alpha.<N>` from the registry, and publishes it to the GitHub npm registry. The alpha line belongs to the git user, not the branch.

## Build the prerelease (step 2)

1. `prepare_task_worktree(upstream)`: call again while it is `preparing`; `failed` → stop with its `error`. All front-monorepo commands below run in its `path`. The alpha is built from the worktree as it is, so `uncommittedFiles` and `unpushedCommits` are included: list them in the report.
2. Packages: the Nx projects whose directories the upstream branch changes (`git diff origin/main...HEAD --name-only`, nearest `project.json`), kept to those listed in `nx.json` `release.projects`. Each one's npm name is the `name` in its `package.json`. Keep those that alumni_connect pins (see Bump).
3. Publish each package as the worktree's own `.claude/skills/publish-alpha/SKILL.md` describes, minus its package-picking questions: `pnpm nx run <project>:build --skip-nx-cache`, then `pnpm nx run <project>:version-alpha`, never a separate `publish`. Take the version from the output and check that it is listed in `gh api orgs/Hivebrite/packages/npm/<name without @hivebrite/>/versions --jq '.[].name'`. A failed package is reported, and the others go on. A publish refused with `403` "does not match expected scopes" fails every package alike: the GitHub token in `~/.npmrc` lacks `write:packages`, so stop at once and ask the user to refresh it.

## Bump (step 3)

alumni_connect pins `@hivebrite/*` packages in its root `package.json` (yarn). For each published package, find the tracked `package.json` files that pin it (`git ls-files '*package.json' | xargs grep -l '"@hivebrite/<name>"'`) and set the exact alpha version, with no range prefix. Then run `yarn install` once.
