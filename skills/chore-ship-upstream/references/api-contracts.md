# api-contracts upstream

Merging to `main` makes CI regenerate the SDKs. A few minutes later, each SDK repo whose contracts changed gets a commit carrying the api-contracts PR's title and a GitHub release with a semver tag. alumni_connect pins the Ruby SDK gems (`Hivebrite/openapi-*`, `Hivebrite/protobuf-*`) in its `Gemfile`.

## Gate (step 2)

No extra condition.

## Before the merge (step 4)

`main` requires the branch to be up to date, so a PR behind it is refused. Per PR, before merging: `gh pr view <n> --repo Hivebrite/api-contracts --json mergeStateStatus`; when `BEHIND`, run `gh pr update-branch <n> --repo Hivebrite/api-contracts` (a merge of `main`, never a rebase). That moves the head: wait for the checks, rerun the step 2 gate (the approval may drop) and take the new `headRefOid` for `--match-head-commit`. The go-ahead covers this update.

## Which SDKs

The SDK gems the alumni_connect PR re-pins: `git diff origin/<base>...HEAD -- Gemfile`, usually a branch or SHA pin on an SDK repo. When it re-pins none, it is the `Gemfile` SDK repos that get a commit carrying the upstream PR's title after the merge; find them while waiting.

## Wait for the release (step 4)

Per SDK repo: `gh release list --repo Hivebrite/<sdk-repo> --limit 5 --json tagName,createdAt`, until a release exists whose tag's commit (`gh api repos/Hivebrite/<sdk-repo>/commits/<tag> --jq .commit.message`) carries the upstream PR's title. A release whose commit does not carry the title is someone else's merge: keep waiting. The target is the newest release, which includes yours.

## Bump (step 5)

`Skill(hivebrite-engineering:update-internal-sdks)` with `main only=<sdk repos>`. The go-ahead covers its confirmation gates: pick its apply-all option yourself, except its breaking-change gate, which goes to the user. It leaves the commit to this chore.
