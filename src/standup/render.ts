import type { ChangeEvent, DiffResult, EventKind, Snapshot, TaskChanges, TaskSnapshot } from "./types";

type SectionId = "shipped" | "forward" | "attention" | "new" | "off";

interface Section {
  id: SectionId;
  heading: string;
  empty: string;
}

const SECTIONS: Section[] = [
  { id: "shipped", heading: "Shipped", empty: "Nothing merged or closed out." },
  { id: "forward", heading: "Moved forward", empty: "No forward movement recorded." },
  { id: "attention", heading: "Needs attention", empty: "Nothing new needing attention." },
  { id: "new", heading: "New on my plate", empty: "Nothing new landed." },
  { id: "off", heading: "Dropped / de-scoped", empty: "" },
];

/** Which section a task lands in, decided by its most significant event. */
const SECTION_BY_KIND: Record<EventKind, SectionId> = {
  completed: "shipped",
  merged: "shipped",
  // A staging/barney deploy is progress, not closure.
  deployed: "forward",
  advanced: "forward",
  pr_ready: "forward",
  approved: "forward",
  comments_cleared: "forward",
  ci_fixed: "forward",
  conflicts_cleared: "forward",
  todos_done: "forward",
  pr_opened: "forward",
  unblocked: "forward",
  off_ice: "forward",
  blocked: "attention",
  regressed: "attention",
  ci_broke: "attention",
  comments_up: "attention",
  conflicts_appeared: "attention",
  on_ice: "attention",
  high_priority_on: "attention",
  added: "new",
  sprint_added: "new",
  todos_added: "new",
  removed: "off",
  pr_closed: "off",
  sprint_removed: "off",
  high_priority_off: "off",
};

/** Lower wins when a task has several events. */
const KIND_RANK: EventKind[] = [
  "completed",
  "merged",
  "blocked",
  "regressed",
  "ci_broke",
  "conflicts_appeared",
  "comments_up",
  "added",
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

function sectionFor(tc: TaskChanges): SectionId {
  const lead = [...tc.events].sort((a, b) => rank(a.kind) - rank(b.kind))[0]!;
  return SECTION_BY_KIND[lead.kind];
}

function taskRef(t: TaskSnapshot, meta: Snapshot["meta"]): string {
  const flags: string[] = [];
  if (t.highPriority) flags.push("high-prio");
  if (t.onIce) flags.push("on ice");
  const suffix = flags.length ? ` _(${flags.join(", ")})_` : "";

  const title = t.title.replace(/\s+/g, " ").trim();
  if (t.jiraKey) {
    const key = meta.jiraHost
      ? `[${t.jiraKey}](${meta.jiraHost.replace(/\/$/, "")}/browse/${t.jiraKey})`
      : t.jiraKey;
    return `**${key}** ${title}${suffix}`;
  }
  if (t.pr) {
    const pr = t.pr.repoPath
      ? `[${t.pr.repo}#${t.pr.number}](https://github.com/${t.pr.repoPath}/pull/${t.pr.number})`
      : `${t.pr.repo}#${t.pr.number}`;
    return `**${pr}** ${title}${suffix}`;
  }
  return `**${title}**${suffix}`;
}

function renderEvents(events: ChangeEvent[]): string[] {
  const lines: string[] = [];
  const sorted = [...events].sort((a, b) => rank(a.kind) - rank(b.kind));
  for (const e of sorted) {
    lines.push(`  - ${e.detail}`);
    for (const item of e.items ?? []) lines.push(`    - ${item}`);
  }
  return lines;
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

/** Current state, not a diff — the "what I'm on today" half of a standup. */
function inFlight(to: Snapshot): TaskSnapshot[] {
  const backlogOrder = to.categories.find((c) => c.name === "Backlog")?.order ?? Infinity;
  return to.tasks
    .filter((t) => !t.categoryDone && !t.onIce && t.categoryOrder != null && t.categoryOrder < backlogOrder)
    .sort((a, b) => (a.categoryOrder ?? 99) - (b.categoryOrder ?? 99) || a.id - b.id);
}

function prState(t: TaskSnapshot): string {
  if (!t.pr) return "";
  const bits: string[] = [];
  if (t.pr.draft) bits.push("draft");
  if (t.pr.checks) bits.push(`CI ${t.pr.checks}`);
  if (t.pr.state === "open") {
    // "4/1 approved" reads like a typo — once the bar is met the count is noise.
    bits.push(
      t.pr.approvals >= t.pr.requiredReviews
        ? "approved"
        : `${t.pr.approvals}/${t.pr.requiredReviews} approved`,
    );
  }
  if (t.pr.unresolvedComments) bits.push(`${t.pr.unresolvedComments} open comments`);
  if (t.pr.conflicts) bits.push("conflicts");
  if (t.pr.deployed.length) bits.push(`on ${t.pr.deployed.join("/")}`);
  return bits.length ? ` — ${bits.join(", ")}` : "";
}

export function renderReport(diff: DiffResult): string {
  const { from, to, changed } = diff;
  const out: string[] = [];

  const heading = new Date(to.takenAt).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  out.push(`# Standup — ${heading}`);
  out.push("");
  out.push(`Changes between the ${from.localDate} and ${to.localDate} snapshots.`);
  out.push("");

  const note = freshnessNote(to);
  if (note) {
    out.push(`> **Heads up:** ${note}`);
    out.push("");
  }

  const bySection = new Map<SectionId, TaskChanges[]>();
  for (const tc of changed) {
    const id = sectionFor(tc);
    bySection.set(id, [...(bySection.get(id) ?? []), tc]);
  }

  if (changed.length === 0) {
    out.push("_No changes between these two snapshots._");
    out.push("");
  }

  for (const section of SECTIONS) {
    const items = bySection.get(section.id) ?? [];
    // "Left my board" is noise when empty; the others are worth stating.
    if (!items.length && !section.empty) continue;
    out.push(`## ${section.heading}`);
    out.push("");
    if (!items.length) {
      out.push(`_${section.empty}_`);
      out.push("");
      continue;
    }
    for (const tc of items) {
      out.push(`- ${taskRef(tc.task, to.meta)}`);
      out.push(...renderEvents(tc.events));
    }
    out.push("");
  }

  const flight = inFlight(to);
  out.push("## In flight right now");
  out.push("");
  if (!flight.length) {
    out.push("_Nothing active._");
  } else {
    for (const t of flight) {
      out.push(`- ${taskRef(t, to.meta)} — ${t.category ?? t.status}${prState(t)}`);
    }
  }
  out.push("");

  const idNote =
    to.meta.assigneeSource === "detected"
      ? ` (auto-detected; set the \`standup_assignee\` setting to pin it)`
      : "";
  out.push("---");
  out.push("");
  out.push(
    `_Scoped to Jira assignee \`${to.meta.assignee ?? "?"}\`${idNote} and GitHub user \`${to.meta.githubUser ?? "?"}\`. Snapshot taken ${formatTakenAt(to.takenAt)}._`,
  );
  out.push("");

  return out.join("\n");
}
