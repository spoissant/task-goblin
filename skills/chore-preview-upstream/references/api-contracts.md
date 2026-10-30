# api-contracts upstream

There is nothing to publish. Every push to an api-contracts branch other than `main` runs the `CI` workflow, which regenerates the SDKs and syncs each changed SDK repo to a branch with the same name. alumni_connect pins the Ruby SDK gems (`Hivebrite/openapi-*`, `Hivebrite/protobuf-*`) in its `Gemfile`, and a branch build is pinned by SHA.

## Build the prerelease (step 2)

1. CI only builds what was pushed. When the upstream task has `unpushedCommits` or `uncommittedFiles`, stop: the user pushes first.
2. Wait for the `CI` run on the branch head: `gh run list --repo Hivebrite/api-contracts --workflow CI --commit <head sha>` (head from `gh api repos/Hivebrite/api-contracts/branches/<headBranch> --jq .commit.sha`). Red: stop and report the run.
3. SDKs: the SDK repos in the `Gemfile` that have a `<headBranch>` branch (`gh api repos/Hivebrite/<sdk-repo>/branches/<headBranch>`).

## Bump (step 3)

`Skill(hivebrite-engineering:update-internal-sdks)` with `<headBranch> only=<sdk repos>`. Choosing the chore covers its confirmation gates: pick its apply-all option yourself, except its breaking-change gate, which goes to the user. It leaves the commit to this chore. Its host `bundle install` is forbidden in alumni_connect: refresh `Gemfile.lock` with `bin/dev update-gems` (webapp container) instead.
