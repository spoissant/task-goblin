# Writing hermetic specs

Read the rules from the source: `git fetch origin main`, then `git show origin/main:docs/pr-review.md` and `origin/main:AGENTS.md`. What they are strictest on:

- `*.hermetic.spec.ts` under the feature's `functional_tests/<office>/<feature>/tests/`, tagged `@hermetic`, `test` from `@playwright/test`, data from `seedScenario` (`common/helpers/hermetic/seedBridge.ts`; flags through its `flags` argument or `setFeatureFlags`), never `declarePersistentData()`. A new seed's fixture type goes in `common/helpers/hermetic/seedTypes.ts`.
- Reuse the facades and helpers. Shared code (facades, `common/helpers/`, configs) is reviewed by QA Auto, and a change to it must keep the E2E and monitoring specs that use it green, so keep it minimal.
- Leave `qase.id()` out: the PR's "Hermetic Qase ids" workflow creates the cases and pushes the ids, and the lint job fails until it has.
- A feature folder's first hermetic spec needs an entry in `.github/ownership/feature-folders.json`, then `git add` the spec and run `python3 .github/scripts/generate_codeowners.py`.
- Select with `getByTestId`. A `data-testid` the page lacks is the parent session's to add (it becomes a cross-repo contract, alumni_connect's `docs/frontend/TEST_IDS.md`). If it lives in front-monorepo, use a role or accessible-name locator instead.

`yarn install` once in a fresh worktree, then `yarn lint` and `yarn format:check` before committing.
