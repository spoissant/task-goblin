import { useState, useEffect, useRef, useSyncExternalStore } from "react";

// Module-level store: agentId → nextPollAt timestamp
const nextPollAtMap = new Map<number, number>();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

export function setNextPollAt(agentId: number, nextPollAt: number) {
  nextPollAtMap.set(agentId, nextPollAt);
  emitChange();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return nextPollAtMap;
}

export function useAgentPollCountdown(
  agentId: number,
  enabled: boolean,
): { remainingMs: number | null } {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRemainingMs(null);
      return;
    }

    const update = () => {
      const nextPollAt = map.get(agentId);
      if (nextPollAt == null) {
        setRemainingMs(null);
      } else {
        setRemainingMs(Math.max(0, nextPollAt - Date.now()));
      }
    };

    update();
    intervalRef.current = setInterval(update, 100);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [agentId, enabled, map]);

  return { remainingMs: enabled ? remainingMs : null };
}
