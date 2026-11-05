// Jira "is blocked by" links, stored on the task as JSON [{key, status}]: the blocker's key and its Jira status at last sync.
import { parseJson } from "./json";

export interface Blocker {
  key: string;
  status: string;
}

export function parseBlockers(value: string | null | undefined): Blocker[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (b): b is Blocker => typeof b?.key === "string" && typeof b?.status === "string",
  );
}

/** Keys of the blockers not yet done; `doneStatuses` are lower-cased status names. */
export function openBlockerKeys(value: string | null | undefined, doneStatuses: Set<string>): string[] {
  return parseBlockers(value)
    .filter((b) => !doneStatuses.has(b.status.toLowerCase()))
    .map((b) => b.key);
}
