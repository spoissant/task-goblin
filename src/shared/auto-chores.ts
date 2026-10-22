// Chores the scheduler starts on its own (mirrors the `auto` entries in
// src/server/lib/chores.ts; the definitions endpoint does not expose them).
export const AUTO_CHORE_KEYS: ReadonlySet<string> = new Set([
  "fix-merge-conflicts",
  "address-pr-comments",
  "fix-pr-checks",
  "continue-work",
  "ai-qa",
  "code-review-pr",
  "deploy-test-env",
]);

/** The `chore_skips` key that pauses every auto-start on one task. */
const AUTO_SKIP_KEY = "auto";

function parseSkips(choreSkips: string | null | undefined): Record<string, boolean> {
  if (!choreSkips) return {};
  try {
    return JSON.parse(choreSkips) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function isAutoPaused(choreSkips: string | null | undefined): boolean {
  return parseSkips(choreSkips)[AUTO_SKIP_KEY] === true;
}

/** The `chore_skips` JSON with the auto pause flipped; "" clears the column like the skips editor does. */
export function toggleAutoPause(choreSkips: string | null | undefined): string {
  const skips = parseSkips(choreSkips);
  if (skips[AUTO_SKIP_KEY]) delete skips[AUTO_SKIP_KEY];
  else skips[AUTO_SKIP_KEY] = true;
  return Object.keys(skips).length > 0 ? JSON.stringify(skips) : "";
}
