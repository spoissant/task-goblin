# Dependency pin conflicts

**Lockfile.** When the branch's only changes to `package.json` / `yarn.lock` are pins (`git diff $(git merge-base HEAD origin/<base>) HEAD -- package.json`), take the base's two files, re-apply the branch's pins in `package.json`, and regenerate with `bin/dev update-yarn` (alumni_connect). Otherwise resolve only the conflicting hunks. Either way, finish with `yarn install --immutable`.

**Both stable.** The higher version wins. If it is the base's, the branch's bump is superseded; say so in the report.

**Alpha pin** (`<version>-<user>-alpha.N`, built from `<version>`). Compare `<version>` with the base's stable:
- Equal or higher: keep the alpha.
- Lower: keeping the alpha rolls the base back, and taking the base drops the fix. Offer **Republish alpha (Recommended)** / Keep old alpha / Take base / Skip.

Peer-dependency warnings against an alpha pin are expected.

## Republish alpha

Find the front-monorepo task that owns the fix (the PR body or `list_tasks`). In its worktree (`~/Code/hivebrite/front-monorepo.<branch-slug>`): `git fetch origin && git merge --no-ff origin/main`, `pnpm i --frozen-lockfile`, `npx nx run <project>:version-alpha` (it prints the new version), then `git push`. Pin that version here, regenerate the lockfile, and `sync_task` both tasks. If the publish is blocked, ask the user to run it and wait.

## Combined alpha (two devs' changes)

Used when two devs' alpha pins of the same package collide on a shared env branch, and only on request. In `~/Code/hivebrite/front-monorepo`: worktree with a local `tmp/<ticket>-combined-alpha` branch from `origin/main` (hooks off), `merge --no-ff` each PR branch, `pnpm i --frozen-lockfile`, `npx nx run <pkg>:typecheck`, `npx nx run <pkg>:version-alpha` (publishes `<version>-<github-username>-alpha.N`), check with `pnpm view @hivebrite/<pkg> versions --json`. Pin it in the env merge only, regenerate `yarn.lock`, leave the PR branch's pin as is and say so. Remove the worktree and leave the temp branch unpushed.

Before replacing an env pin, read its commit body: it may already be a combined alpha.

Offer a Slack DM to the dev whose pin was replaced. Show the draft and send only on explicit approval; Slack messages cannot be unsent.
