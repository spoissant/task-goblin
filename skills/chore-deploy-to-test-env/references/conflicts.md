# Env-branch conflicts

Classify each conflicted file before touching it; there is no per-merge default. Check what each side is: `git log origin/<env> --format='%h %an %s' -- <file>`, and whether the task's PR touches the file at all (`gh pr diff <n> --name-only`).

## Resolve without asking

- Dependency pins (`package.json`, `Gemfile`): keep the higher version; never downgrade either side. Keep env-only pins on the env side: an SDK on `branch: "deploy/<env>"` or a SHA commented STAGING ONLY. Its lock version can read lower than sprint's tag while being content-ahead: `gh api repos/Hivebrite/<sdk>/compare/<tag>...deploy/<env>`.
- Lockfiles: resolve `package.json` first, then start `yarn.lock` from the env side and run `yarn install --mode=update-lockfile`; for `Gemfile.lock`, edit hunk-wise. Don't `checkout --ours/--theirs` a whole pin or generated file: it drops the cleanly merged hunks outside the conflict.
- `db/schema.rb` `version:`: the newer one.
- Additive on both sides (specs, CODEOWNERS lines, generated doc rows): keep both.
- The env holds an older revision of work that has since merged to sprint: take sprint for every file of that work together.
- The env holds work sprint has never seen (empty incoming side, or another dev's PR deployed but not merged): keep the env side.

Check after: `git diff origin/<env> -- package.json Gemfile` shows no downgrade and only the pins you intended.

## Ask

- Two different prerelease pins (`-<name>-alpha.N`) of the same package from different devs. Exceptions you may resolve yourself: the env pin is the user's own older alpha (supersede it); the other dev's ticket is Ready to Merge or merged (take sprint). Options: keep the env pin, take ours, or build a combined alpha per `~/.claude/skills/chore-fix-merge-conflicts/references/dependency-pins.md` ("Combined alpha").
- Two different implementations of the same behaviour (both sides changed logic, not just versions or wording).
