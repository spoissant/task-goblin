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

Reports are scoped to the board's **Sprint view**: tasks in the active sprint
or flagged high priority. Everything else stays out of the standup. Tasks on ice
or flagged high priority are tagged as such on their line, in every section.

Reports answer three questions, one line per task:

- **Done** — tasks that reached a done column or had their PR merged since the
  previous snapshot.
- **Working on** — everything currently between Backlog and Done (Blocked
  included, on-ice included but tagged and listed last), with its column and PR
  state, plus the most notable change since last time in italics.
- **New, not started** — backlog work that appeared in the sprint view since the
  previous snapshot: added to the board, pulled into the sprint, or flagged
  high priority. The rest of the backlog stays quiet.

Detected changes include status moves, completions, reopenings, block/unblock,
PRs opened, leaving draft, hitting the repo's own `required_reviews`, CI
flipping, review comments arriving or clearing, merge conflicts, new deployment
branches, merges, sprint moves, on-ice, high-priority flags, and checklist items
ticked off or added.

## How snapshots get taken

**Manually, just before your meeting.** Hit **Snapshot now** on the Standup
page (or run `bun run standup:snapshot`). It syncs Jira and GitHub first, then
writes today's snapshot, overwriting any earlier one from the same day. The
report then compares it to the previous snapshot — normally the one you took
before yesterday's meeting — so the window is exactly "since we last talked".
Reports warn at the top whenever the snapshot they used was built on sync data
more than six hours old.

Because a day only gets a snapshot when you take one, weekends and days off
never produce noise in the diff.

### Optional: launchd

`scripts/com.taskgoblin.standup-*.plist` are launchd agents (snapshot at 00:05,
markdown report at 08:30). They are **not needed** and not installed by
default. Install them only if you want a snapshot taken for you at a fixed
time instead of pressing the button:

```bash
cp scripts/com.taskgoblin.standup-*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.taskgoblin.standup-snapshot.plist
```

They run through a login shell so `bun` is on `PATH`, and write to
`logs/standup-*.log`. Be aware that at 00:05 the API server is usually down, so
those snapshots can't sync and will hold the previous afternoon's data. A
manual **Snapshot now** later that day overwrites it with synced data.

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
