# Writing and running hermetic specs

## The hivetests worktree

The branch is the alumni_connect task's `headBranch`, exactly: that name is what makes alumni_connect's build run it (`resolve_hivetests_ref`) and the two PRs merge together. From `~/Code/hivebrite/hivetests`, after `git fetch origin`:

- the branch exists (local or `origin`): `wt switch <branch> --no-cd --yes --format json`;
- otherwise: `wt switch <branch> --create --base origin/main --no-cd --yes --format json`.

The JSON's `path` is the worktree (`~/Code/hivebrite/hivetests.<branch with / as ->`), the same one Task Goblin reuses when a later session prepares the sub-task. Run `yarn install` there. A hivetests worktree that already holds the branch with uncommitted changes: ask before touching it.

## Seeds (this alumni_connect worktree)

`docs/testing/HERMETIC_PLAYWRIGHT.md` "Adding a scenario" is the contract: a seed under `lib/hermetic_e2e/seeds/` subclassing `HermeticE2e::Seeds::Base`, registered in `HermeticE2e::SeedsController::SEEDS`, returning only what the browser needs. Prefer an option on an existing seed over a new one. Keyword arguments are the whole contract, and array options must be declared so `permitted_options` keeps them. A service the stack does not run needs a fake on the bridge (the `HermeticE2e::Fake*` pattern); if none exists, the scenario is E2E only.

## Specs (hivetests worktree)

Follow `docs/pr-review.md` and `AGENTS.md` as read in step 1. What they are strictest on:

- `*.hermetic.spec.ts` under the feature's `functional_tests/<office>/<feature>/tests/`, tagged `@hermetic`, `test` from `@playwright/test`, data from `seedScenario` (`common/helpers/hermetic/seedBridge.ts`; flags through its `flags` argument or `setFeatureFlags`), never `declarePersistentData()`.
- Reuse the facades and helpers; a change to shared code (facades, `common/helpers/`, configs) is reviewed by QA Auto and must keep the E2E and monitoring specs that use it green, so keep it minimal.
- Leave `qase.id()` out: the PR's "Hermetic Qase ids" workflow creates the cases and pushes the ids. The lint job fails until it has.
- A feature folder's first hermetic spec needs an entry in `.github/ownership/feature-folders.json`, then `git add` the spec and run `python3 .github/scripts/generate_codeowners.py`.
- A `data-testid` the spec needs and the page lacks is added in the alumni_connect PR (it becomes a cross-repo contract, `docs/frontend/TEST_IDS.md`). If it lives in front-monorepo, use a role or accessible-name locator instead.

`yarn lint` and `yarn format:check` in the hivetests worktree before running.

## Local run (from this alumni_connect worktree)

`bin/dev playwright-hermetic` needs test assets: build them with `ENVIRONMENT=test bin/node_exec --build-assets` when its preflight says they are missing or older than `front/src`.

The `playwright` container mounts `HIVETESTS_PATH` when it is created, so if it is already running from another checkout, remove it first (`bin/dev dc rm -sf playwright`). Then `HIVETESTS_PATH=<hivetests worktree> bin/dev playwright-hermetic <spec paths relative to the hivetests root>` with `run_in_background`, covering the new specs plus the regression run. The preflight warning about the hivetests branch must not appear; if it does, the mount is wrong.

Retries are off locally, so a failure is a real failure or a flake to fix in the spec (pr-review's waits and anti-flake sections), never a retry. A seed change restarts the test server on its own; the artifacts land in `artifacts/playwright/`.
