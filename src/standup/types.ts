// Types for the standup snapshot + diff pipeline.

export interface StatusCategory {
  name: string;
  done: boolean;
  order: number;
}

export interface PrSnapshot {
  number: number;
  repo: string; // short label (alias, or owner/repo)
  repoPath: string | null; // owner/repo, for links
  state: string | null; // open | closed | merged
  draft: boolean;
  checks: string | null; // passing | failing | pending
  approvals: number;
  requiredReviews: number;
  unresolvedComments: number;
  conflicts: boolean;
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
  headBranch: string | null;
  deployed: string[];
}

export interface TodoSnapshot {
  id: number;
  content: string;
  done: string | null; // ISO timestamp
}

export interface TaskSnapshot {
  id: number;
  jiraKey: string | null;
  title: string;
  status: string;
  category: string | null;
  categoryOrder: number | null;
  categoryDone: boolean;
  type: string | null;
  priority: string | null;
  sprint: string | null;
  assignee: string | null;
  epicKey: string | null;
  parentKey: string | null;
  highPriority: boolean;
  onIce: boolean;
  onIceReason: string | null;
  pr: PrSnapshot | null;
  todos: TodoSnapshot[];
  workingOn: string | null;
  updatedAt: string;
}

export interface SnapshotMeta {
  /** Identity used to scope "my" tasks. */
  assignee: string | null;
  githubUser: string | null;
  jiraHost: string | null;
  assigneeSource: "flag" | "setting" | "detected" | "none";
  jiraDeltaSyncedAt: string | null;
  jiraReconciledAt: string | null;
  /** Did this run trigger a fresh sync before reading the DB? */
  syncTriggered: boolean;
  syncError: string | null;
}

export interface Snapshot {
  version: 1;
  takenAt: string; // ISO
  localDate: string; // YYYY-MM-DD in local time
  meta: SnapshotMeta;
  categories: StatusCategory[];
  tasks: TaskSnapshot[];
}

export type EventKind =
  | "completed"
  | "merged"
  | "advanced"
  | "regressed"
  | "blocked"
  | "unblocked"
  | "added"
  | "removed"
  | "pr_opened"
  | "pr_ready"
  | "pr_closed"
  | "approved"
  | "comments_up"
  | "comments_cleared"
  | "ci_fixed"
  | "ci_broke"
  | "conflicts_appeared"
  | "conflicts_cleared"
  | "deployed"
  | "sprint_added"
  | "sprint_removed"
  | "on_ice"
  | "off_ice"
  | "high_priority_on"
  | "high_priority_off"
  | "todos_done"
  | "todos_added";

export interface ChangeEvent {
  kind: EventKind;
  detail: string;
  /** Extra lines nested under the event (e.g. todo contents). */
  items?: string[];
}

export interface TaskChanges {
  task: TaskSnapshot; // current state (or last known, for "removed")
  events: ChangeEvent[];
}

export interface DiffResult {
  from: Snapshot;
  to: Snapshot;
  changed: TaskChanges[];
}
