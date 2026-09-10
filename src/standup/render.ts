import type { ChangeEvent, DiffResult, EventKind, Snapshot, TaskChanges, TaskSnapshot } from "./types";

/** Lower wins when a task has several events — the one worth saying out loud. */
const KIND_RANK: EventKind[] = [
  "completed",
  "merged",
  "blocked",
  "regressed",
  "ci_broke",
  "conflicts_appeared",
  "comments_up",
  "deployed",
  "approved",
  "pr_ready",
  "pr_opened",
  "advanced",
  "unblocked",
  "ci_fixed",
  "comments_cleared",
  "conflicts_cleared",
  "todos_done",
  "on_ice",
  "off_ice",
  "high_priority_on",
  "sprint_added",
  "added",
  "sprint_removed",
  "high_priority_off",
  "todos_added",
  "pr_closed",
  "removed",
];

const rank = (k: EventKind) => {
  const i = KIND_RANK.indexOf(k);
  return i === -1 ? KIND_RANK.length : i;
};

const leadEvent = (events: ChangeEvent[]): ChangeEvent | undefined =>
  [...events].sort((a, b) => rank(a.kind) - rank(b.kind))[0];

const has = (tc: TaskChanges | undefined, ...kinds: EventKind[]) =>
  !!tc && tc.events.some((e) => kinds.includes(e.kind));

function taskRef(t: TaskSnapshot, meta: Snapshot["meta"]): string {
  const title = t.title.replace(/\s+/g, " ").trim();
  if (t.jiraKey) {
    const key = meta.jiraHost
      ? `[${t.jiraKey}](${meta.jiraHost.replace(/\/$/, "")}/browse/${t.jiraKey})`
      : t.jiraKey;
    return `**${key}** ${title}`;
  }
  if (t.pr) {
    const pr = t.pr.repoPath
      ? `[${t.pr.repo}#${t.pr.number}](https://github.com/${t.pr.repoPath}/pull/${t.pr.number})`
      : `${t.pr.repo}#${t.pr.number}`;
    return `**${pr}** ${title}`;
  }
  return `**${title}**`;
}

function formatTakenAt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function freshnessNote(to: Snapshot): string | null {
  const synced = to.meta.jiraDeltaSyncedAt;
  if (!synced) return "No Jira sync timestamp recorded — the snapshot may be stale.";
  const ageH = (Date.parse(to.takenAt) - Date.parse(synced)) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH < 6) return null;
  return `Jira data was ${Math.round(ageH)}h old when this snapshot was taken (last sync ${synced}) — run a sync for an accurate picture.`;
}

/** Compact PR state for a line: "CI failing, 1/2 approved, 3 open comments". */
function prState(t: TaskSnapshot): string[] {
  if (!t.pr || t.pr.state !== "open") return [];
  const bits: string[] = [];
  if (t.pr.draft) bits.push("draft");
  if (t.pr.checks) bits.push(`CI ${t.pr.checks}`);
  // "4/1 approved" reads like a typo — once the bar is met the count is noise.
  bits.push(
    t.pr.approvals >= t.pr.requiredReviews ? "approved" : `${t.pr.approvals}/${t.pr.requiredReviews} approved`,
  );
  if (t.pr.unresolvedComments) bits.push(`${t.pr.unresolvedComments} open comments`);
  if (t.pr.conflicts) bits.push("conflicts");
  if (t.pr.deployed.length) bits.push(`on ${t.pr.deployed.join("/")}`);
  return bits;
}

const byColumn = (a: TaskSnapshot, b: TaskSnapshot) =>
  (a.categoryOrder ?? 99) - (b.categoryOrder ?? 99) || a.id - b.id;

/** Mirrors the board's "Sprint view" toggle: in the sprint, or flagged high priority. */
const inSprintView = (t: TaskSnapshot) => !!t.sprint || t.highPriority;

/** Flags worth calling out on every line, whatever section the task lands in. */
function flags(t: TaskSnapshot): string[] {
  const bits: string[] = [];
  if (t.onIce) bits.push(t.onIceReason ? `on ice — ${t.onIceReason}` : "on ice");
  if (t.highPriority) bits.push("high-prio");
  return bits;
}

/**
 * Scoped to the sprint view. Three questions, one line per task:
 *   Done        — reached a done column or got its PR merged since last time
 *   Working on  — everything currently between Backlog and Done (Blocked and on-ice included, tagged)
 *   New         — appeared in the sprint view and is not started
 */
export function renderReport(diff: DiffResult): string {
  const { to, changed } = diff;
  const changes = new Map(changed.map((tc) => [tc.task.id, tc]));
  const backlogOrder = to.categories.find((c) => c.name === "Backlog")?.order ?? Infinity;
  const isBacklog = (t: TaskSnapshot) => t.categoryOrder == null || t.categoryOrder >= backlogOrder;
  const isBlocked = (t: TaskSnapshot) => t.category === "Blocked";
  const tasks = to.tasks.filter(inSprintView);

  const done = tasks.filter((t) => has(changes.get(t.id), "completed", "merged")).sort(byColumn);

  const working = tasks
    .filter((t) => !t.categoryDone && (isBlocked(t) || !isBacklog(t)))
    .filter((t) => !done.includes(t))
    .sort(
      (a, b) =>
        Number(a.onIce) - Number(b.onIce) || Number(isBlocked(a)) - Number(isBlocked(b)) || byColumn(a, b),
    );

  const fresh = tasks
    .filter((t) => !t.categoryDone && isBacklog(t) && !isBlocked(t))
    .filter((t) => has(changes.get(t.id), "added", "sprint_added", "high_priority_on"))
    .sort(byColumn);

  const out: string[] = [];
  const heading = new Date(to.takenAt).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  out.push(`# Standup — ${heading}`, "");

  const note = freshnessNote(to);
  if (note) out.push(`> **Heads up:** ${note}`, "");

  out.push("## Done", "");
  if (!done.length) out.push("_Nothing closed out._");
  for (const t of done) {
    const lead = leadEvent(changes.get(t.id)!.events)!;
    const bits = [...flags(t)];
    if (lead.kind === "merged" && !t.categoryDone) bits.push(`PR merged, ticket still ${t.category ?? t.status}`);
    out.push(`- ${taskRef(t, to.meta)}${bits.length ? ` — ${bits.join(", ")}` : ""}`);
  }
  out.push("");

  out.push("## Working on", "");
  if (!working.length) out.push("_Nothing active._");
  for (const t of working) {
    const state = [t.category ?? t.status, ...prState(t), ...flags(t)];
    const tc = changes.get(t.id);
    const lead = tc && leadEvent(tc.events);
    const since = lead ? ` · _${lead.kind === "added" ? "new" : lead.detail}_` : "";
    out.push(`- ${taskRef(t, to.meta)} — ${state.join(", ")}${since}`);
  }
  out.push("");

  out.push("## New, not started", "");
  if (!fresh.length) out.push("_Nothing new landed._");
  for (const t of fresh) {
    const bits: string[] = [];
    if (t.sprint && has(changes.get(t.id), "sprint_added")) bits.push(`sprint ${t.sprint}`);
    bits.push(...flags(t));
    out.push(`- ${taskRef(t, to.meta)}${bits.length ? ` — ${bits.join(", ")}` : ""}`);
  }
  out.push("");

  out.push(`_Since ${formatTakenAt(diff.from.takenAt)}, snapshot ${formatTakenAt(to.takenAt)}._`, "");

  return out.join("\n");
}
