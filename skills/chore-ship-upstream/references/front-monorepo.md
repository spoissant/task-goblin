# front-monorepo upstream

A merged PR gets released only for the `publish-<project>-<major|minor|patch>` labels it carries. The `Release - Create Publish PR on Label` workflow runs on the merged PR's head commit and, per label, opens or updates a release PR from the `hivebrite-cd` bot:

- label `release`, branch `version-publish-<project>-<run id>`;
- title `chore: publish <project>-<version> [publish-<project>-<bump>]`;
- body is the changelog, linking each PR it ships.

An open release PR the bot updates may also ship other merged PRs for the same package. Auto-merge is already on, so one approval merges it once its checks pass. The version reaches the GitHub npm registry about a minute after the merge.

## Gate (step 2)

The upstream PR carries at least one `publish-*` label; none means no release will ever come. The go-ahead lists each label as a release PR to approve.

## Wait for the release (step 4)

1. Wait for the `Release - Create Publish PR on Label` run on the upstream PR's head commit: `gh run list --repo Hivebrite/front-monorepo --workflow "Release - Create Publish PR on Label" --commit <headRefOid>`. Red: stop and report.
2. Per `publish-*` label, find the open release PR whose title carries `[publish-<project>-`: `gh pr list --repo Hivebrite/front-monorepo --label release --state open --json number,title,body`.
3. Approve each one with `gh pr review <r> --repo Hivebrite/front-monorepo --approve`.
4. Wait until each is merged.
5. Read the package's npm name and version from the `package.json` the release PR changed, at `main`. Wait until the version is listed in `gh api orgs/Hivebrite/packages/npm/<name without @hivebrite/>/versions --jq '.[].name'`.

## Bump (step 5)

alumni_connect pins `@hivebrite/*` packages in its root `package.json` (yarn). `update-internal-sdks` reads this repo as Ruby and misses them, so bump by hand. For each released package, find the tracked `package.json` files that pin it (`git ls-files '*package.json' | xargs grep -l '"@hivebrite/<name>"'`) and set the new version, keeping each pin's range prefix. Then run `yarn install` once. A released package that alumni_connect does not pin is skipped and named in the report; when none is pinned, stop.
