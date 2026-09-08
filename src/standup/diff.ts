import { isBlockedCategory } from "./categories";
import type { ChangeEvent, DiffResult, Snapshot, TaskChanges, TaskSnapshot } from "./types";

const asBlocked = (t: TaskSnapshot) => isBlockedCategory({ name: t.category ?? "", done: false, order: 0 });

const label = (t: TaskSnapshot) => t.category ?? t.status;

function todoText(content: string, max = 90): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function statusEvents(prev: TaskSnapshot, cur: TaskSnapshot, events: ChangeEvent[]): void {
  if (prev.category === cur.category && prev.status === cur.status) return;

  const wasBlocked = asBlocked(prev);
  const isBlocked = asBlocked(cur);

  if (!prev.categoryDone && cur.categoryDone) {
    events.push({ kind: "completed", detail: `${label(prev)} → ${label(cur)}` });
    return;
  }
  if (prev.categoryDone && !cur.categoryDone) {
    events.push({ kind: "regressed", detail: `reopened: ${label(prev)} → ${label(cur)}` });
    return;
  }
  if (!wasBlocked && isBlocked) {
    events.push({ kind: "blocked", detail: `${label(prev)} → Blocked` });
    return;
  }
  if (wasBlocked && !isBlocked) {
    events.push({ kind: "unblocked", detail: `Blocked → ${label(cur)}` });
    return;
  }

  const a = prev.categoryOrder;
  const b = cur.categoryOrder;
  if (a != null && b != null && a !== b) {
    // display_order counts down towards Done (0), so a lower order is further along.
    events.push({
      kind: b < a ? "advanced" : "regressed",
      detail: `${label(prev)} → ${label(cur)}`,
    });
    return;
  }
  // Same column, different raw Jira status (e.g. QA → Ready for Test).
  events.push({ kind: "advanced", detail: `${prev.status} → ${cur.status}` });
}

function prEvents(prev: TaskSnapshot, cur: TaskSnapshot, events: ChangeEvent[]): void {
  const p = prev.pr;
  const c = cur.pr;
  if (!c) return;

  const ref = `#${c.number}`;

  if (!p) {
    events.push({
      kind: "pr_opened",
      detail: c.draft ? `opened ${ref} as draft (${c.repo})` : `opened ${ref} (${c.repo})`,
    });
  } else {
    if (p.state !== "merged" && c.state === "merged") {
      events.push({ kind: "merged", detail: `${ref} merged` });
    } else if (p.state === "open" && c.state === "closed") {
      events.push({ kind: "pr_closed", detail: `${ref} closed without merging` });
    }
    if (p.draft && !c.draft) events.push({ kind: "pr_ready", detail: `${ref} out of draft` });

    if (c.state === "open") {
      if (p.approvals < c.requiredReviews && c.approvals >= c.requiredReviews) {
        events.push({
          kind: "approved",
          detail: `${ref} approved (${c.approvals}/${c.requiredReviews})`,
        });
      }
      if (c.unresolvedComments > p.unresolvedComments) {
        events.push({
          kind: "comments_up",
          detail: `${ref} has ${c.unresolvedComments} unresolved comment${c.unresolvedComments === 1 ? "" : "s"} (was ${p.unresolvedComments})`,
        });
      } else if (p.unresolvedComments > 0 && c.unresolvedComments === 0) {
        events.push({ kind: "comments_cleared", detail: `${ref} review comments all resolved` });
      }
      if (p.checks === "failing" && c.checks === "passing") {
        events.push({ kind: "ci_fixed", detail: `${ref} CI green again` });
      } else if (p.checks === "passing" && c.checks === "failing") {
        events.push({ kind: "ci_broke", detail: `${ref} CI now failing` });
      }
      if (!p.conflicts && c.conflicts) {
        events.push({ kind: "conflicts_appeared", detail: `${ref} has merge conflicts` });
      } else if (p.conflicts && !c.conflicts) {
        events.push({ kind: "conflicts_cleared", detail: `${ref} conflicts resolved` });
      }
    }

    const gained = c.deployed.filter((b) => !p.deployed.includes(b));
    if (gained.length) {
      events.push({ kind: "deployed", detail: `${ref} now on ${gained.join(", ")}` });
    }
  }
}

function flagEvents(prev: TaskSnapshot, cur: TaskSnapshot, events: ChangeEvent[]): void {
  if (prev.sprint !== cur.sprint) {
    events.push(
      cur.sprint
        ? { kind: "sprint_added", detail: `pulled into sprint ${cur.sprint}` }
        : { kind: "sprint_removed", detail: `dropped from sprint ${prev.sprint}` },
    );
  }
  if (!prev.onIce && cur.onIce) {
    events.push({
      kind: "on_ice",
      detail: cur.onIceReason ? `put on ice — ${cur.onIceReason}` : "put on ice",
    });
  } else if (prev.onIce && !cur.onIce) {
    events.push({ kind: "off_ice", detail: "taken off ice" });
  }
  if (!prev.highPriority && cur.highPriority) {
    events.push({ kind: "high_priority_on", detail: "flagged high priority" });
  } else if (prev.highPriority && !cur.highPriority) {
    events.push({ kind: "high_priority_off", detail: "high priority cleared" });
  }
}

function todoEvents(prev: TaskSnapshot, cur: TaskSnapshot, events: ChangeEvent[]): void {
  const before = new Map(prev.todos.map((t) => [t.id, t]));

  const finished = cur.todos.filter((t) => t.done && !before.get(t.id)?.done);
  if (finished.length) {
    events.push({
      kind: "todos_done",
      detail: `ticked off ${finished.length} checklist item${finished.length === 1 ? "" : "s"}`,
      items: finished.map((t) => todoText(t.content)),
    });
  }

  const fresh = cur.todos.filter((t) => !before.has(t.id) && !t.done);
  if (fresh.length) {
    events.push({
      kind: "todos_added",
      detail: `${fresh.length} new checklist item${fresh.length === 1 ? "" : "s"}`,
      items: fresh.map((t) => todoText(t.content)),
    });
  }
}

export function diffSnapshots(from: Snapshot, to: Snapshot): DiffResult {
  const before = new Map(from.tasks.map((t) => [t.id, t]));
  const after = new Map(to.tasks.map((t) => [t.id, t]));
  const changed: TaskChanges[] = [];

  for (const cur of to.tasks) {
    const prev = before.get(cur.id);
    if (!prev) {
      const detail = cur.pr
        ? `new — ${label(cur)}, PR #${cur.pr.number} (${cur.pr.repo})`
        : `new — ${label(cur)}`;
      changed.push({ task: cur, events: [{ kind: "added", detail }] });
      continue;
    }
    const events: ChangeEvent[] = [];
    statusEvents(prev, cur, events);
    prEvents(prev, cur, events);
    flagEvents(prev, cur, events);
    todoEvents(prev, cur, events);
    if (events.length) changed.push({ task: cur, events });
  }

  for (const prev of from.tasks) {
    if (after.has(prev.id)) continue;
    // Done work ages out of snapshots by design — that is not a change.
    if (prev.categoryDone) continue;
    changed.push({
      task: prev,
      events: [{ kind: "removed", detail: `no longer on my board (was ${label(prev)})` }],
    });
  }

  return { from, to, changed };
}
