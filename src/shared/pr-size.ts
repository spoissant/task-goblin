import type { PrSize } from "./types";

// Classify a PR by review effort. Mirrors task-goblin's Reviews page badge.
// Kept in shared/ so server route + client UI use the same thresholds.
//
// Only lines changed matter. File count used to gate this, but it punished the
// cheapest reviews: a rename, an import sweep or a CODEOWNERS touch spread over
// a dozen files is still a two-minute read.
export function categorizePrSize(additions: number | null, deletions: number | null): PrSize {
  // No stats at all — don't claim it's small, make the reviewer look.
  if (additions == null && deletions == null) return "large";
  const lines = (additions ?? 0) + (deletions ?? 0);
  if (lines <= 200) return "small";
  if (lines <= 800) return "medium";
  return "large";
}
