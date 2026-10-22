/**
 * A PR's checks as synced from GitHub: which ones set its checks status, and
 * when the ones failing it last finished.
 */
import type { CheckDetail } from "@/shared/types";
import { parseJson } from "@/shared/json";

/** The checks that set the PR's checks status: the required ones, or every check when none is required. */
export function countedChecks<T extends Pick<CheckDetail, "isRequired">>(details: T[]): T[] {
  const required = details.filter((d) => d.isRequired);
  return required.length > 0 ? required : details;
}

export function isFailedCheck(detail: Pick<CheckDetail, "conclusion">): boolean {
  return detail.conclusion === "failure" || detail.conclusion === "timed_out";
}

/**
 * When the checks failing the PR last finished, from a task's `checksDetails`;
 * a re-run that fails again on the same commit moves it.
 */
export function checksFailedAt(checksDetails: string | null): string | null {
  const times = countedChecks(parseJson<CheckDetail[]>(checksDetails, []))
    .filter(isFailedCheck)
    .map((d) => d.completedAt ?? "");
  return times.sort().at(-1) || null;
}
