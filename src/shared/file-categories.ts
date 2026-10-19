import type { ChangesByCategory, FileChanges } from "./types";

export function categorizeFile(filename: string): "frontend" | "backend" | "other" {
  const lower = filename.toLowerCase();

  if (/\.(js|jsx|ts|tsx|vue|haml)$/.test(lower)) return "frontend";
  if (/\.(css|scss|sass|less)$/.test(lower)) return "frontend";
  if (/\.(rb|rake|gemspec|rabl)$/.test(lower)) return "backend";
  if (lower === "gemfile" || lower === "gemfile.lock") return "backend";

  const frontendPaths = ["frontend/", "front/", "app/javascript/", "client/", "packages/"];
  const backendPaths = ["app/models/", "app/controllers/", "app/services/", "app/workers/", "app/mailers/", "app/helpers/", "lib/", "db/", "config/", "spec/", "test/"];

  if (frontendPaths.some((p) => lower.startsWith(p))) return "frontend";
  if (backendPaths.some((p) => lower.startsWith(p))) return "backend";

  return "other";
}

export function bucketFilesByCategory(
  files: Array<{ filename: string; additions: number; deletions: number }>
): ChangesByCategory {
  const empty = (): FileChanges => ({ files: 0, additions: 0, deletions: 0 });
  const buckets: ChangesByCategory = { frontend: empty(), backend: empty(), other: empty() };
  for (const file of files) {
    const cat = categorizeFile(file.filename);
    buckets[cat].files += 1;
    buckets[cat].additions += file.additions;
    buckets[cat].deletions += file.deletions;
  }
  return buckets;
}

/** Read the JSON stored on a task. Absent or malformed means unknown. */
export function parseChangesByCategory(json: string | null): ChangesByCategory | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const buckets = parsed as ChangesByCategory;
    if (!buckets.frontend || !buckets.backend || !buckets.other) return null;
    return buckets;
  } catch {
    return null;
  }
}
