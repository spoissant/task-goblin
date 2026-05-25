import type { PrSize } from "./types";

// Classify a PR by review effort. Mirrors task-goblin's Reviews page badge.
// Kept in shared/ so server route + client UI use the same thresholds.
export function categorizePrSize(files: number | null, additions: number | null, deletions: number | null): PrSize {
  const f = files ?? Infinity;
  const lines = (additions ?? 0) + (deletions ?? 0);
  if (f <= 5 && lines <= 200) return "small";
  if (f <= 15 && lines <= 800) return "medium";
  return "large";
}
