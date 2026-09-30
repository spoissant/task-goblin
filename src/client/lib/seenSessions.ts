import { useSyncExternalStore } from "react";
import type { ClaudeSession } from "./types";

/**
 * Finished sessions whose result has been looked at, kept in localStorage.
 * Shared by every AI cell so marking one seen re-renders the others.
 * Sessions that finished before this was first used count as seen, so
 * existing history doesn't all light up at once.
 */
const KEY = "seenSessions";

interface Stored {
  since: string;
  ids: number[];
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to a fresh store
  }
  const fresh = { since: new Date().toISOString(), ids: [] };
  save(fresh);
  return fresh;
}

function save(value: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // not persisted; still tracked for this page load
  }
}

let stored = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markSessionSeen(id: number) {
  if (stored.ids.includes(id)) return;
  // Keep the list short; old ids belong to sessions long superseded.
  stored = { ...stored, ids: [...stored.ids, id].slice(-500) };
  save(stored);
  listeners.forEach((l) => l());
}

export function useSessionSeen(session: ClaudeSession | undefined): boolean {
  const snapshot = useSyncExternalStore(subscribe, () => stored);
  if (!session) return true;
  const finishedAt = session.firstTerminalAt ?? session.updatedAt;
  return finishedAt < snapshot.since || snapshot.ids.includes(session.id);
}
