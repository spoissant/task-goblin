# Running hermetic specs locally

Shared by `/chore-hermetic-tests` and `/chore-ai-qa` on a hivetests sub-task. The suite runs from the alumni_connect parent's worktree, against its code, with the specs from the hivetests worktree mounted.

From the parent's worktree (`cd` there, back afterwards):

1. Test assets: `ENVIRONMENT=test bin/node_exec --build-assets` when the run's preflight says they are missing or older than `front/src`.
2. The `playwright` container mounts `HIVETESTS_PATH` when it is created. If it is already running from another checkout, remove it: `bin/dev dc rm -sf playwright`.
3. `env HIVETESTS_PATH=<hivetests worktree> bin/dev playwright-hermetic <spec paths relative to the hivetests root>`, with `run_in_background`. The preflight warning about the hivetests branch must not appear; if it does, the mount is wrong.

Retries are off locally, so a failure is a real failure or a flake to fix in the spec (pr-review's waits and anti-flake sections), never a retry. A Ruby change in the parent restarts the test server on its own. Traces and screenshots land in the parent's `artifacts/playwright/`.

A failure is on one side:

- **Spec**: a wrong locator, wait or expectation. Fixed in the hivetests worktree.
- **alumni_connect**: the feature or the seed does not do what the plan says. Reported with the evidence, for the parent's session or the user. Never edited from the hivetests side.
