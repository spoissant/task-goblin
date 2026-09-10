import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestTables } from "../test/createSchema";
import { buildCategoryResolver } from "./categories";
import { diffSnapshots } from "./diff";
import { renderReport } from "./render";
import {
  StandupRangeError,
  buildReport,
  listSnapshotDates,
  loadSnapshot,
  resolveRange,
  writeSnapshot,
} from "./service";
import { takeSnapshot } from "./snapshot";
import type { EventKind, Snapshot } from "./types";

const ME = "Simon Poissant";
const SPRINT = "Connect & Learn - 26.4.3";

const CATEGORIES: [string, number, number, string[]][] = [
  ["Done", 1, 0, ["Done", "Closed", "Ready to Prod", "Cancelled", "Define preventive measures"]],
  ["Ready to Merge", 0, 1, ["Ready to Merge"]],
  ["QA", 0, 2, ["QA", "Design QA", "Ready for Test"]],
  ["Code Review", 0, 3, ["Code Review", "Review"]],
  ["In Progress", 0, 4, ["In Progress"]],
  ["Backlog", 0, 5, ["To Do", "Open", "Backlog", "Accepted", "Ready to Refine", "Triage Needed"]],
  ["Blocked", 0, 6, ["Blocked", "On Hold"]],
];

interface Seed {
  id: number;
  title: string;
  status: string;
  jira_key?: string | null;
  assignee?: string | null;
  sprint?: string | null;
  high_priority?: number;
  on_ice?: number;
  pr_number?: number | null;
  repository_id?: number | null;
  pr_state?: string | null;
  pr_author?: string | null;
  is_draft?: number;
  checks_status?: string | null;
  approved_review_count?: number | null;
  unresolved_comment_count?: number;
  has_conflicts?: number;
  deployed_on_branches?: string | null;
  updated_at?: string;
}

function insertTasks(db: Database, seeds: Seed[], updatedAt: string): void {
  const stmt = db.prepare(`insert into tasks
    (id,title,status,created_at,updated_at,jira_key,assignee,sprint,high_priority,on_ice,
     pr_number,repository_id,pr_state,pr_author,is_draft,checks_status,approved_review_count,
     unresolved_comment_count,has_conflicts,deployed_on_branches)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of seeds) {
    stmt.run(
      s.id, s.title, s.status, "2026-01-01T00:00:00.000Z", s.updated_at ?? updatedAt,
      s.jira_key ?? null, s.assignee ?? null, s.sprint ?? null,
      s.high_priority ?? 0, s.on_ice ?? 0,
      s.pr_number ?? null, s.repository_id ?? null, s.pr_state ?? null,
      s.pr_author ?? (s.pr_number ? "spoissant" : null),
      s.is_draft ?? 0, s.checks_status ?? null, s.approved_review_count ?? null,
      s.unresolved_comment_count ?? 0, s.has_conflicts ?? 0, s.deployed_on_branches ?? null,
    );
  }
}

const DAY1 = new Date("2026-09-02T23:59:00.000Z");
const DAY2 = new Date("2026-09-03T23:59:00.000Z");

function snapshotPair(seeds: Seed[], mutate: (db: Database) => void): [Snapshot, Snapshot] {
  const path = `/tmp/standup-test-${Math.random().toString(36).slice(2)}.db`;
  const db = new Database(path, { create: true });
  createTestTables(db);
  const insCat = db.prepare(
    "insert into status_categories (name,color,done,display_order,jira_mappings) values (?,?,?,?,?)",
  );
  for (const [name, done, order, maps] of CATEGORIES) {
    insCat.run(name, "bg-slate-500", done, order, JSON.stringify(maps));
  }
  const insSetting = db.prepare("insert into settings (key,value) values (?,?)");
  insSetting.run("jira_host", "https://hivebrite.atlassian.net");
  insSetting.run("github_username", "spoissant");
  insSetting.run("jira_delta_synced_at", "2026-09-03T13:58:00.000Z");
  const insRepo = db.prepare(
    "insert into repositories (id,owner,repo,alias,enabled,deployment_branches,required_reviews) values (?,?,?,?,1,?,?)",
  );
  insRepo.run(1, "Hivebrite", "alumni_connect", "ac", JSON.stringify(["staging", "barney"]), 1);
  insRepo.run(6, "Hivebrite", "claude-code-plugins", null, null, 2);
  insertTasks(db, seeds, "2026-09-02T09:00:00.000Z");

  const day1 = takeSnapshot({ dbPath: path, now: DAY1 });
  mutate(db);
  const day2 = takeSnapshot({ dbPath: path, now: DAY2 });
  db.close();
  return [day1, day2];
}

const kindsFor = (day1: Snapshot, day2: Snapshot, taskId: number): EventKind[] => {
  const tc = diffSnapshots(day1, day2).changed.find((c) => c.task.id === taskId);
  return (tc?.events ?? []).map((e) => e.kind);
};

const base: Seed = { id: 1, title: "A ticket", status: "In Progress", jira_key: "EV-1", assignee: ME, sprint: SPRINT };

describe("category resolution", () => {
  const resolver = buildCategoryResolver(
    CATEGORIES.map(([name, done, display_order, maps]) => ({
      name, done, display_order, jira_mappings: JSON.stringify(maps),
    })),
  );

  test("maps raw Jira statuses onto workflow columns", () => {
    expect(resolver.resolve("Ready to Prod")?.name).toBe("Done");
    expect(resolver.resolve("Ready for Test")?.name).toBe("QA");
    expect(resolver.resolve("On Hold")?.name).toBe("Blocked");
  });

  test("is case-insensitive, as Jira statuses drift in casing", () => {
    expect(resolver.resolve("Code review")?.name).toBe("Code Review");
    expect(resolver.resolve("On hold")?.name).toBe("Blocked");
    expect(resolver.resolve("Triage needed")?.name).toBe("Backlog");
  });

  test("maps legacy snake_case statuses from before the status migration", () => {
    expect(resolver.resolve("code_review")?.name).toBe("Code Review");
    expect(resolver.resolve("in_progress")?.name).toBe("In Progress");
    expect(resolver.resolve("ready_to_merge")?.name).toBe("Ready to Merge");
    expect(resolver.resolve("done")?.name).toBe("Done");
  });

  test("returns null for unknown statuses rather than guessing", () => {
    expect(resolver.resolve("Awaiting Sorcery")).toBeNull();
    expect(resolver.resolve(null)).toBeNull();
  });
});

describe("snapshot scoping", () => {
  test("keeps my tickets, my PRs and manual tasks; drops other people's", () => {
    const [day1] = snapshotPair(
      [
        { ...base, id: 1 },
        { id: 2, title: "Someone else's story", status: "Backlog", jira_key: "TT-1", assignee: "Lucas LEMAHIEU" },
        { id: 3, title: "Unlinked PR of mine", status: "Code Review", pr_number: 158, repository_id: 6, pr_state: "open" },
        { id: 4, title: "Manual note to self", status: "Backlog" },
        { id: 5, title: "Someone else's PR", status: "Code Review", pr_number: 99, repository_id: 1, pr_state: "open", pr_author: "franckduche" },
      ],
      () => {},
    );
    expect(day1.tasks.map((t) => t.id).sort()).toEqual([1, 3, 4]);
  });

  test("auto-detects the operator from the dominant assignee", () => {
    const [day1] = snapshotPair(
      [
        { ...base, id: 1 },
        { ...base, id: 2, jira_key: "EV-2" },
        { id: 3, title: "Theirs", status: "Backlog", jira_key: "TT-1", assignee: "Lucas LEMAHIEU" },
      ],
      () => {},
    );
    expect(day1.meta.assignee).toBe(ME);
    expect(day1.meta.assigneeSource).toBe("detected");
  });

  test("ages out long-settled work but keeps recent completions", () => {
    const [day1] = snapshotPair(
      [
        { ...base, id: 1, status: "Done", updated_at: "2026-01-05T00:00:00.000Z" },
        { ...base, id: 2, jira_key: "EV-2", status: "Done", updated_at: "2026-09-01T00:00:00.000Z" },
      ],
      () => {},
    );
    expect(day1.tasks.map((t) => t.id)).toEqual([2]);
  });
});

describe("status transitions", () => {
  test("reaching a done column is a completion", () => {
    const [d1, d2] = snapshotPair([{ ...base, status: "Code review" }], (db) =>
      db.exec("update tasks set status='Ready to Prod' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toContain("completed");
  });

  test("moving towards Done is forward progress", () => {
    const [d1, d2] = snapshotPair([{ ...base, status: "To Do" }], (db) =>
      db.exec("update tasks set status='In Progress' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["advanced"]);
  });

  test("moving away from Done is a regression", () => {
    const [d1, d2] = snapshotPair([{ ...base, status: "QA" }], (db) =>
      db.exec("update tasks set status='In Progress' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["regressed"]);
  });

  test("Blocked is treated as a side-state, not the back of the pipeline", () => {
    const [d1, d2] = snapshotPair([{ ...base, status: "In Progress" }], (db) =>
      db.exec("update tasks set status='Blocked' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["blocked"]);

    const [e1, e2] = snapshotPair([{ ...base, status: "On hold" }], (db) =>
      db.exec("update tasks set status='In Progress' where id=1"),
    );
    expect(kindsFor(e1, e2, 1)).toEqual(["unblocked"]);
  });

  test("a reopened ticket is a regression, not a completion", () => {
    const [d1, d2] = snapshotPair([{ ...base, status: "Done", updated_at: "2026-09-01T00:00:00.000Z" }], (db) =>
      db.exec("update tasks set status='In Progress' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["regressed"]);
  });
});

describe("pull request signals", () => {
  const withPr: Seed = { ...base, status: "Code Review", pr_number: 500, repository_id: 1, pr_state: "open", checks_status: "passing", approved_review_count: 0 };

  test("a merged PR is reported even when Jira has not caught up", () => {
    const [d1, d2] = snapshotPair([withPr], (db) =>
      db.exec("update tasks set pr_state='merged' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toContain("merged");
  });

  test("leaving draft is progress", () => {
    const [d1, d2] = snapshotPair([{ ...withPr, is_draft: 1 }], (db) =>
      db.exec("update tasks set is_draft=0 where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["pr_ready"]);
  });

  test("approval fires against the repo's own required_reviews", () => {
    // alumni_connect needs 1 approval.
    const [d1, d2] = snapshotPair([withPr], (db) =>
      db.exec("update tasks set approved_review_count=1 where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["approved"]);

    // claude-code-plugins needs 2, so one approval is not yet news.
    const twoReviews = { ...withPr, repository_id: 6 };
    const [e1, e2] = snapshotPair([twoReviews], (db) =>
      db.exec("update tasks set approved_review_count=1 where id=1"),
    );
    expect(kindsFor(e1, e2, 1)).toEqual([]);

    const [f1, f2] = snapshotPair([twoReviews], (db) =>
      db.exec("update tasks set approved_review_count=2 where id=1"),
    );
    expect(kindsFor(f1, f2, 1)).toEqual(["approved"]);
  });

  test("CI flips in both directions", () => {
    const [d1, d2] = snapshotPair([{ ...withPr, checks_status: "failing" }], (db) =>
      db.exec("update tasks set checks_status='passing' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["ci_fixed"]);

    const [e1, e2] = snapshotPair([withPr], (db) =>
      db.exec("update tasks set checks_status='failing' where id=1"),
    );
    expect(kindsFor(e1, e2, 1)).toEqual(["ci_broke"]);
  });

  test("new review comments are surfaced and clearing them is progress", () => {
    const [d1, d2] = snapshotPair([withPr], (db) =>
      db.exec("update tasks set unresolved_comment_count=3 where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["comments_up"]);

    const [e1, e2] = snapshotPair([{ ...withPr, unresolved_comment_count: 3 }], (db) =>
      db.exec("update tasks set unresolved_comment_count=0 where id=1"),
    );
    expect(kindsFor(e1, e2, 1)).toEqual(["comments_cleared"]);
  });

  test("reports only newly gained deployment branches", () => {
    const [d1, d2] = snapshotPair([{ ...withPr, deployed_on_branches: '["staging"]' }], (db) =>
      db.exec(`update tasks set deployed_on_branches='["staging","barney"]' where id=1`),
    );
    const tc = diffSnapshots(d1, d2).changed.find((c) => c.task.id === 1);
    expect(tc?.events.map((e) => e.kind)).toEqual(["deployed"]);
    expect(tc?.events[0]!.detail).toContain("barney");
    expect(tc?.events[0]!.detail).not.toContain("staging");
  });

  test("a PR appearing on a ticket is reported", () => {
    const [d1, d2] = snapshotPair([base], (db) =>
      db.exec("update tasks set pr_number=600, repository_id=1, pr_state='open', pr_author='spoissant' where id=1"),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["pr_opened"]);
  });
});

describe("board membership", () => {
  test("a ticket that appears is new", () => {
    const [d1, d2] = snapshotPair([base], (db) =>
      db.exec(
        `insert into tasks (id,title,status,created_at,updated_at,jira_key,assignee) values (2,'Fresh','Backlog','2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z','EV-9','${ME}')`,
      ),
    );
    expect(kindsFor(d1, d2, 2)).toEqual(["added"]);
  });

  test("a ticket that disappears has left the board", () => {
    const [d1, d2] = snapshotPair([base], (db) => db.exec("delete from tasks where id=1"));
    expect(kindsFor(d1, d2, 1)).toEqual(["removed"]);
  });

  test("done work ageing out of the snapshot is not reported as removed", () => {
    // Sits just inside the 30-day window on day 1, outside it on day 2.
    const settled = new Date(DAY1.getTime() - 29.5 * 86_400_000).toISOString();
    const [d1, d2] = snapshotPair([{ ...base, status: "Done", updated_at: settled }], () => {});
    expect(d1.tasks).toHaveLength(1);
    expect(d2.tasks).toHaveLength(0);
    expect(diffSnapshots(d1, d2).changed).toEqual([]);
  });
});

describe("checklist and flags", () => {
  test("completed todos are listed by content", () => {
    const [d1, d2] = snapshotPair([base], (db) => {
      db.exec(
        `insert into todos (id,content,done,task_id,position,created_at,updated_at) values (1,'Ship the translations',null,1,1,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')`,
      );
      db.exec("update todos set done='2026-09-03T10:00:00.000Z' where id=1");
    });
    // The todo did not exist in day1 at all, so it reads as newly added and done.
    const tc = diffSnapshots(d1, d2).changed.find((c) => c.task.id === 1);
    expect(tc?.events.map((e) => e.kind)).toEqual(["todos_done"]);
    expect(tc?.events[0]!.items).toEqual(["Ship the translations"]);
  });

  test("ticking off a pre-existing todo is reported", () => {
    const path = `/tmp/standup-test-${Math.random().toString(36).slice(2)}.db`;
    const db = new Database(path, { create: true });
    createTestTables(db);
    const insCat = db.prepare(
      "insert into status_categories (name,color,done,display_order,jira_mappings) values (?,?,?,?,?)",
    );
    for (const [name, done, order, maps] of CATEGORIES) insCat.run(name, "c", done, order, JSON.stringify(maps));
    db.exec("insert into settings (key,value) values ('github_username','spoissant')");
    insertTasks(db, [base], "2026-09-02T09:00:00.000Z");
    db.exec(
      `insert into todos (id,content,done,task_id,position,created_at,updated_at) values (1,'Blocker A',null,1,1,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')`,
    );
    const d1 = takeSnapshot({ dbPath: path, now: DAY1 });
    db.exec("update todos set done='2026-09-03T10:00:00.000Z' where id=1");
    db.exec(
      `insert into todos (id,content,done,task_id,position,created_at,updated_at) values (2,'Blocker B',null,1,2,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z')`,
    );
    const d2 = takeSnapshot({ dbPath: path, now: DAY2 });
    db.close();
    expect(kindsFor(d1, d2, 1).sort()).toEqual(["todos_added", "todos_done"]);
  });

  test("sprint moves distinguish being pulled in from being dropped", () => {
    const [d1, d2] = snapshotPair([{ ...base, sprint: null }], (db) =>
      db.exec(`update tasks set sprint='${SPRINT}' where id=1`),
    );
    expect(kindsFor(d1, d2, 1)).toEqual(["sprint_added"]);

    const [e1, e2] = snapshotPair([base], (db) => db.exec("update tasks set sprint=null where id=1"));
    expect(kindsFor(e1, e2, 1)).toEqual(["sprint_removed"]);
  });

  test("on-ice carries its reason", () => {
    const [d1, d2] = snapshotPair([base], (db) =>
      db.exec("update tasks set on_ice=1, on_ice_reason='waiting on design' where id=1"),
    );
    const tc = diffSnapshots(d1, d2).changed.find((c) => c.task.id === 1);
    expect(tc?.events[0]!.kind).toBe("on_ice");
    expect(tc?.events[0]!.detail).toContain("waiting on design");
  });
});

describe("report rendering", () => {
  const section = (md: string, name: string) => md.split(`## ${name}`)[1]!.split("\n## ")[0]!;

  test("answers done / working on / new, one line per task", () => {
    const [d1, d2] = snapshotPair(
      [
        { ...base, id: 1, jira_key: "EV-1", status: "Code Review", pr_number: 1, repository_id: 1, pr_state: "open", checks_status: "passing" },
        { ...base, id: 2, jira_key: "EV-2", status: "In Progress" },
        { ...base, id: 3, jira_key: "EV-3", status: "In Progress", pr_number: 3, repository_id: 1, pr_state: "open", checks_status: "passing", deployed_on_branches: "[]" },
        { ...base, id: 4, jira_key: "EV-4", status: "Backlog" },
      ],
      (db) => {
        db.exec("update tasks set status='Done', pr_state='merged' where id=1");
        db.exec("update tasks set status='Blocked' where id=2");
        db.exec(`update tasks set deployed_on_branches='["staging"]' where id=3`);
        db.exec(`insert into tasks (id,title,status,created_at,updated_at,jira_key,assignee,sprint)
          values (5,'Fresh','Backlog','2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z','EV-5','${ME}','${SPRINT}')`);
      },
    );
    const md = renderReport(diffSnapshots(d1, d2));

    expect(section(md, "Done")).toContain("EV-1");
    // Blocked is still on my plate; a staging deploy is progress, not closure.
    const working = section(md, "Working on");
    expect(working).toContain("EV-2");
    expect(working).toContain("Blocked");
    expect(working).toContain("EV-3");
    expect(working).toContain("now on staging");
    expect(working).not.toContain("EV-1");
    expect(working).not.toContain("EV-4");
    // Only backlog work that appeared since last time is "new"; the old backlog stays quiet.
    const fresh = section(md, "New, not started");
    expect(fresh).toContain("EV-5");
    expect(fresh).not.toContain("EV-4");
    // One line per task — no nested event bullets.
    expect(md).not.toMatch(/^ {2}- /m);
  });

  test("a merged PR whose ticket has not caught up still counts as done", () => {
    const [d1, d2] = snapshotPair(
      [{ ...base, status: "Code Review", pr_number: 1, repository_id: 1, pr_state: "open" }],
      (db) => db.exec("update tasks set pr_state='merged' where id=1"),
    );
    const done = section(renderReport(diffSnapshots(d1, d2)), "Done");
    expect(done).toContain("EV-1");
    expect(done).toContain("ticket still Code Review");
  });

  test("links Jira keys and PRs", () => {
    const [d1, d2] = snapshotPair([{ ...base, pr_number: 158, repository_id: 6, pr_state: "open" }], (db) =>
      db.exec("update tasks set status='Done' where id=1"),
    );
    const md = renderReport(diffSnapshots(d1, d2));
    expect(md).toContain("https://hivebrite.atlassian.net/browse/EV-1");
  });

  test("warns when the snapshot was taken on stale sync data", () => {
    const [d1, d2] = snapshotPair([base], (db) => db.exec("update tasks set status='Done' where id=1"));
    // Sync ran 2026-09-03T13:58, snapshot taken 2026-09-03T23:59.
    expect(renderReport(diffSnapshots(d1, d2))).toContain("Heads up");
  });

  test("uses empty placeholders when nothing changed", () => {
    const [d1, d2] = snapshotPair([{ ...base, status: "Backlog" }], () => {});
    const md = renderReport(diffSnapshots(d1, d2));
    expect(md).toContain("Nothing closed out");
    expect(md).toContain("Nothing active");
    expect(md).toContain("Nothing new landed");
  });

  test("working on excludes backlog, done and iced work", () => {
    const [, d2] = snapshotPair(
      [
        { ...base, id: 1, jira_key: "EV-1", status: "In Progress" },
        { ...base, id: 2, jira_key: "EV-2", status: "Backlog" },
        { ...base, id: 3, jira_key: "EV-3", status: "In Progress", on_ice: 1 },
        { ...base, id: 4, jira_key: "EV-4", status: "Done" },
      ],
      () => {},
    );
    const working = section(renderReport(diffSnapshots(d2, d2)), "Working on");
    expect(working).toContain("EV-1");
    expect(working).not.toContain("EV-2");
    expect(working).not.toContain("EV-3");
    expect(working).not.toContain("EV-4");
  });
});

describe("snapshot range resolution", () => {
  const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];

  test("defaults to the two most recent snapshots", () => {
    expect(resolveRange(dates)).toEqual({ from: "2026-09-02", to: "2026-09-03" });
  });

  test("an explicit `to` compares against the snapshot before it", () => {
    expect(resolveRange(dates, null, "2026-09-02")).toEqual({
      from: "2026-09-01",
      to: "2026-09-02",
    });
  });

  test("honours an explicit range, including a multi-day one", () => {
    expect(resolveRange(dates, "2026-09-01", "2026-09-03")).toEqual({
      from: "2026-09-01",
      to: "2026-09-03",
    });
  });

  test("refuses a range it cannot satisfy", () => {
    expect(() => resolveRange(["2026-09-03"])).toThrow(StandupRangeError);
    expect(() => resolveRange(dates, null, "2026-09-01")).toThrow(/earlier than/);
    expect(() => resolveRange(dates, "2026-09-03", "2026-09-01")).toThrow(/not earlier/);
    expect(() => resolveRange(dates, null, "2026-08-30")).toThrow(/No snapshot for/);
  });
});

describe("snapshot files on disk", () => {
  const tmpDir = () => `/tmp/standup-dir-${Math.random().toString(36).slice(2)}`;

  function seedDb(): string {
    const path = `/tmp/standup-db-${Math.random().toString(36).slice(2)}.db`;
    const db = new Database(path, { create: true });
    createTestTables(db);
    const insCat = db.prepare(
      "insert into status_categories (name,color,done,display_order,jira_mappings) values (?,?,?,?,?)",
    );
    for (const [name, done, order, maps] of CATEGORIES) insCat.run(name, "c", done, order, JSON.stringify(maps));
    db.exec("insert into settings (key,value) values ('github_username','spoissant')");
    insertTasks(db, [base], "2026-09-02T09:00:00.000Z");
    db.close();
    return path;
  }

  test("writes a dated snapshot and refuses to clobber it without --force", async () => {
    const dir = tmpDir();
    const dbPath = seedDb();

    const first = await writeSnapshot({ dir, dbPath, date: "2026-09-02" });
    expect(first.written).toBe(true);
    expect(first.taskCount).toBe(1);

    const second = await writeSnapshot({ dir, dbPath, date: "2026-09-02" });
    expect(second.written).toBe(false);

    const forced = await writeSnapshot({ dir, dbPath, date: "2026-09-02", force: true });
    expect(forced.written).toBe(true);

    expect(await listSnapshotDates(dir)).toEqual(["2026-09-02"]);
  });

  test("builds a report from two snapshots on disk", async () => {
    const dir = tmpDir();
    const dbPath = seedDb();
    await writeSnapshot({ dir, dbPath, date: "2026-09-02" });

    const db = new Database(dbPath);
    db.exec("update tasks set status='Done' where id=1");
    db.close();
    await writeSnapshot({ dir, dbPath, date: "2026-09-03" });

    const report = await buildReport({ dir });
    expect(report.from).toBe("2026-09-02");
    expect(report.to).toBe("2026-09-03");
    expect(report.changedCount).toBe(1);
    expect(report.markdown).toContain("## Done");
    expect(report.available).toEqual(["2026-09-02", "2026-09-03"]);
  });

  test("records the date it was named with, so filename and content agree", async () => {
    const dir = tmpDir();
    const dbPath = seedDb();
    await writeSnapshot({ dir, dbPath, date: "2026-09-02" });
    // Otherwise a backfilled snapshot reports today's date in its own body,
    // and the report header names the same day twice.
    expect((await loadSnapshot("2026-09-02", dir)).localDate).toBe("2026-09-02");
  });

  test("reports no snapshots rather than throwing on a missing directory", async () => {
    expect(await listSnapshotDates(tmpDir())).toEqual([]);
  });
});
