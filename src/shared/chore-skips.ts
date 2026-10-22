// A task's `chore_skips` column, JSON like {"fix-pr-checks": true, "auto": true}:
// the chores never suggested for it, and the pause on every auto-start.
import { parseJson } from "./json";

/** The `chore_skips` key that pauses every auto-start on one task. */
const AUTO_SKIP_KEY = "auto";

export function parseChoreSkips(choreSkips: string | null | undefined): Record<string, boolean> {
  return parseJson<Record<string, boolean>>(choreSkips, {});
}

/** The `chore_skips` JSON with `key` skipped or not; "" clears the column once nothing is skipped. */
export function setChoreSkip(choreSkips: string | null | undefined, key: string, skipped: boolean): string {
  const skips = parseChoreSkips(choreSkips);
  if (skipped) skips[key] = true;
  else delete skips[key];
  return Object.keys(skips).length > 0 ? JSON.stringify(skips) : "";
}

export function isAutoPaused(choreSkips: string | null | undefined): boolean {
  return parseChoreSkips(choreSkips)[AUTO_SKIP_KEY] === true;
}

/** The `chore_skips` JSON with the auto pause flipped. */
export function toggleAutoPause(choreSkips: string | null | undefined): string {
  return setChoreSkip(choreSkips, AUTO_SKIP_KEY, !isAutoPaused(choreSkips));
}
