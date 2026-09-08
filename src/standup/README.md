# Standup summaries

Answers "what did I actually do yesterday?" by diffing two daily snapshots of
your Task Goblin board.

Task Goblin keeps no history: `tasks.updated_at` is bumped by every sync, so it
cannot tell you what *changed*. This takes a dated snapshot once a day and
compares consecutive snapshots instead.

## Where to read it

**The app, at [/standup](http://localhost:5173/standup).** The page builds the
diff on demand from whatever snapshots are on disk, so it is always current —
it does not wait for the report job. It has a date pair picker for comparing
any two snapshots, a **Copy** button for pasting into Slack, and a **Snapshot
now** button that syncs Jira and GitHub first, so you can cut a fresh
comparison point mid-day.

The CLI does the same thing from a terminal:

```bash
bun run standup:snapshot     # sync, then write snapshots/<today>.json
bun run standup              # diff the two newest snapshots -> standup/<date>.md
```

Useful flags:

| Flag | Applies to | Effect |
|------|-----------|--------|
| `--force` | snapshot | Overwrite today's snapshot instead of skipping |
| `--no-sync` | snapshot | Don't call the API first; read the DB as-is |
| `--date YYYY-MM-DD` | snapshot | Write under a different date |
| `--db PATH` | snapshot | Read a different database file |
| `--me "Name"` | snapshot | Pin the Jira display name used for scoping |
| `--from` / `--to` | report | Diff specific dates instead of the newest two |
| `--no-write` | report | Print to stdout only |

`GET /api/v1/standup[?from=&to=]` returns `{ report, available, reason }` —
`report` is `null` with a `reason` when fewer than two snapshots exist, which
is the normal first-run state rather than an error. `GET
/api/v1/standup/snapshots` lists the dates on disk; `POST` to the same path
(`{"force":true}` to overwrite today) writes one.

Snapshots land in `snapshots/`, reports in `standup/`. Both are gitignored, and
snapshots are kept indefinitely (~320 KB/day, so roughly 100 MB a year) so
you can build weekly or monthly rollups later. If that ever bothers you,
lowering `DONE_RETENTION_DAYS` in `snapshot.ts` is the biggest lever — about
90% of each file is recently-completed work.

## What counts as "mine"

A task is in scope when its Jira assignee is you, **or** its PR author is your
`github_username`, **or** it is a manual task with neither a Jira key nor a PR.

Your Jira display name is not stored anywhere in the DB, so it is resolved in
this order: the `--me` flag, then a `standup_assignee` row in `settings`, then
the most frequent assignee on the board (Task Goblin is single-user, so that is
you). Whichever was used is recorded in the snapshot and printed at the foot of
every report — pin it via `standup_assignee` if the guess is ever wrong.

Tasks in a done column that haven't moved for 30 days drop out of snapshots;
they can no longer produce a change worth reporting. Ageing out is deliberately
*not* reported as "left my board".

## What gets reported

Statuses are mapped through `status_categories` onto the seven workflow
columns, case-insensitively and tolerating the legacy snake_case values
(`code_review`, `done`) that predate the status migration. `display_order`
counts down to Done, so a lower order is further along; `Blocked` is treated as
a side-state rather than the back of the queue.

Reports group changes into **Shipped**, **Moved forward**, **Needs attention**,
**New on my plate** and **Dropped / de-scoped**, then list what is currently in
flight. Detected events include status moves, completions, reopenings,
block/unblock, PRs opened, leaving draft, hitting the repo's own
`required_reviews`, CI flipping, review comments arriving or clearing, merge
conflicts, new deployment branches, merges, sprint moves, on-ice, high-priority
flags, and checklist items ticked off or added.

## Scheduling

The page needs only the **snapshot** job; the report job is optional and just
keeps a markdown copy in `standup/` for grepping or pasting elsewhere.

`scripts/com.taskgoblin.standup-*.plist` are launchd agents — a snapshot at
00:05 and a report at 08:30. Install with:

```bash
cp scripts/com.taskgoblin.standup-*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.taskgoblin.standup-snapshot.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.taskgoblin.standup-report.plist
```

They run through a login shell so `bun` is on `PATH`, and write to
`logs/standup-*.log`. If the Mac is asleep at the scheduled time launchd runs
the job on wake.

### A caveat about midnight

The database only knows what the last sync told it. `standup:snapshot` tries to
`POST /api/v1/sync/{jira,github}` first, but that needs `bun run dev:api` to be
up — at 00:05 it usually isn't, so the snapshot captures yesterday afternoon's
sync. That is fine for a day-over-day diff (both ends are equally stale), but if
you want each snapshot to be genuinely current, move the snapshot job to the
morning and let it sync first:

```xml
<key>Hour</key><integer>8</integer>
<key>Minute</key><integer>0</integer>
```

Reports warn at the top whenever the snapshot they used was built on sync data
more than six hours old.

## Layout

| File | Role |
|------|------|
| `snapshot.ts` | Read the DB, scope to you, emit a `Snapshot` |
| `diff.ts` | Classify the changes between two snapshots |
| `render.ts` | Turn a diff into standup markdown |
| `categories.ts` | Raw Jira status → workflow column |
| `service.ts` | Snapshot files on disk: list, load, resolve a range, build a report |
| `cli.ts` | `snapshot` / `report` commands |
| `standup.test.ts` | `bun test src/standup` |

The API route lives in `src/server/routes/standup.ts`, the page in
`src/client/pages/StandupPage.tsx`.

These read the SQLite file directly with `bun:sqlite` rather than going through
drizzle or the API, so the launchd jobs work whether or not the dev server is
running.
