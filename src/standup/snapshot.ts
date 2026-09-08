import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { buildCategoryResolver } from "./categories";
import type { Snapshot, SnapshotMeta, TaskSnapshot, TodoSnapshot } from "./types";

/** Done tasks older than this are dropped from snapshots to keep files small.
 *  They can no longer produce standup-relevant changes. */
const DONE_RETENTION_DAYS = 30;

interface TaskRow {
  id: number;
  title: string;
  status: string;
  updated_at: string;
  jira_key: string | null;
  type: string | null;
  assignee: string | null;
  priority: string | null;
  sprint: string | null;
  epic_key: string | null;
  parent_key: string | null;
  high_priority: number | null;
  on_ice: number | null;
  on_ice_reason: string | null;
  pr_number: number | null;
  pr_state: string | null;
  pr_author: string | null;
  is_draft: number | null;
  checks_status: string | null;
  approved_review_count: number | null;
  unresolved_comment_count: number | null;
  has_conflicts: number | null;
  changed_files: number | null;
  additions: number | null;
  deletions: number | null;
  head_branch: string | null;
  deployed_on_branches: string | null;
  on_deployment_branches: string | null;
  working_on: string | null;
  repo_label: string | null;
  repo_path: string | null;
  required_reviews: number | null;
}

const bool = (v: number | null | undefined) => v === 1;

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface TakeSnapshotOptions {
  dbPath?: string;
  /** Override the Jira display name used to scope "my" tasks. */
  me?: string;
  syncTriggered?: boolean;
  syncError?: string | null;
  now?: Date;
  /** The date this snapshot represents. Defaults to today in local time; set
   *  explicitly so a snapshot's recorded date always matches its filename. */
  date?: string;
}

/** Read-only is the right default — this runs unattended and must never
 *  disturb the app's database. A WAL left behind by a crashed writer can only
 *  be recovered by a read-write connection, though, so fall back rather than
 *  let the nightly job die. */
function openDb(path: string): Database {
  try {
    return new Database(path, { readonly: true });
  } catch (err) {
    // Only a WAL that needs recovering justifies a read-write open. If the
    // file isn't there, falling back would silently create an empty database.
    if (!existsSync(path)) throw err;
    console.warn(
      `Read-only open of ${path} failed (${err instanceof Error ? err.message : err}); reopening read-write to recover the WAL.`,
    );
    return new Database(path);
  }
}

export function takeSnapshot(opts: TakeSnapshotOptions = {}): Snapshot {
  const db = openDb(opts.dbPath ?? process.env.DATABASE_URL ?? "task-goblin.db");
  try {
    const settings = new Map<string, string | null>(
      db
        .query<{ key: string; value: string | null }, []>("select key, value from settings")
        .all()
        .map((r) => [r.key, r.value]),
    );

    const githubUser = settings.get("github_username") ?? null;

    // Identity: explicit flag > stored setting > most-frequent assignee.
    // Task Goblin is single-user and syncs `assignee = currentUser()` by
    // default, so the dominant assignee is the operator.
    let assignee: string | null = null;
    let assigneeSource: SnapshotMeta["assigneeSource"] = "none";
    if (opts.me) {
      assignee = opts.me;
      assigneeSource = "flag";
    } else if (settings.get("standup_assignee")) {
      assignee = settings.get("standup_assignee")!;
      assigneeSource = "setting";
    } else {
      const top = db
        .query<{ assignee: string; c: number }, []>(
          "select assignee, count(*) c from tasks where assignee is not null group by 1 order by c desc limit 1",
        )
        .get();
      if (top) {
        assignee = top.assignee;
        assigneeSource = "detected";
      }
    }

    const resolver = buildCategoryResolver(
      db
        .query<
          { name: string; done: number; display_order: number; jira_mappings: string | null },
          []
        >("select name, done, display_order, jira_mappings from status_categories order by display_order")
        .all(),
    );

    const rows = db
      .query<TaskRow, [string | null, string | null]>(
        `select t.id, t.title, t.status, t.updated_at, t.jira_key, t.type, t.assignee,
                t.priority, t.sprint, t.epic_key, t.parent_key,
                t.high_priority, t.on_ice, t.on_ice_reason,
                t.pr_number, t.pr_state, t.pr_author, t.is_draft, t.checks_status,
                t.approved_review_count, t.unresolved_comment_count, t.has_conflicts,
                t.changed_files, t.additions, t.deletions, t.head_branch,
                t.deployed_on_branches, t.on_deployment_branches, t.working_on,
                coalesce(r.alias, r.owner || '/' || r.repo) as repo_label,
                (r.owner || '/' || r.repo) as repo_path,
                r.required_reviews
           from tasks t
           left join repositories r on r.id = t.repository_id
          where t.assignee = ?
             or t.pr_author = ?
             or (t.jira_key is null and t.pr_number is null)
          order by t.updated_at desc`,
      )
      .all(assignee, githubUser);

    const todosByTask = new Map<number, TodoSnapshot[]>();
    for (const t of db
      .query<{ id: number; content: string; done: string | null; task_id: number | null }, []>(
        "select id, content, done, task_id from todos where task_id is not null order by position, id",
      )
      .all()) {
      const list = todosByTask.get(t.task_id!) ?? [];
      list.push({ id: t.id, content: t.content, done: t.done });
      todosByTask.set(t.task_id!, list);
    }

    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - DONE_RETENTION_DAYS * 86_400_000).toISOString();

    const tasks: TaskSnapshot[] = [];
    for (const r of rows) {
      const cat = resolver.resolve(r.status);
      // Drop long-settled work so snapshot files stay small.
      if (cat?.done && r.updated_at < cutoff) continue;

      tasks.push({
        id: r.id,
        jiraKey: r.jira_key,
        title: r.title,
        status: r.status,
        category: cat?.name ?? null,
        categoryOrder: cat?.order ?? null,
        categoryDone: !!cat?.done,
        type: r.type,
        priority: r.priority,
        sprint: r.sprint,
        assignee: r.assignee,
        epicKey: r.epic_key,
        parentKey: r.parent_key,
        highPriority: bool(r.high_priority),
        onIce: bool(r.on_ice),
        onIceReason: r.on_ice_reason,
        pr:
          r.pr_number == null
            ? null
            : {
                number: r.pr_number,
                repo: r.repo_label ?? "?",
                repoPath: r.repo_path,
                state: r.pr_state,
                draft: bool(r.is_draft),
                checks: r.checks_status,
                approvals: r.approved_review_count ?? 0,
                requiredReviews: r.required_reviews ?? 1,
                unresolvedComments: r.unresolved_comment_count ?? 0,
                conflicts: bool(r.has_conflicts),
                changedFiles: r.changed_files,
                additions: r.additions,
                deletions: r.deletions,
                headBranch: r.head_branch,
                // Prefer branches confirmed deployed; fall back to
                // branches the commit is merely present on.
                deployed: parseStringArray(r.deployed_on_branches).length
                  ? parseStringArray(r.deployed_on_branches)
                  : parseStringArray(r.on_deployment_branches),
              },
        todos: todosByTask.get(r.id) ?? [],
        workingOn: r.working_on,
        updatedAt: r.updated_at,
      });
    }

    return {
      version: 1,
      takenAt: now.toISOString(),
      localDate: opts.date ?? localDate(now),
      meta: {
        assignee,
        githubUser,
        jiraHost: settings.get("jira_host") ?? null,
        assigneeSource,
        jiraDeltaSyncedAt: settings.get("jira_delta_synced_at") ?? null,
        jiraReconciledAt: settings.get("jira_reconciled_at") ?? null,
        syncTriggered: opts.syncTriggered ?? false,
        syncError: opts.syncError ?? null,
      },
      categories: resolver.categories,
      tasks,
    };
  } finally {
    db.close();
  }
}
