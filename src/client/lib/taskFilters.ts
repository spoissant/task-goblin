import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

// The Tasks page keeps its search and filters in the URL so back/forward walk through them.
const BOOL_DEFAULTS = {
  sprint: true,
  backlog: false,
  hideOnIce: true,
  hideParents: false,
  hideIdle: false,
  idleOnly: false,
};

export type BoolFilter = keyof typeof BOOL_DEFAULTS;

export interface TaskFilters extends Record<BoolFilter, boolean> {
  q: string;
  repo: number[]; // repository ids to include (any of them); empty = all
  notRepo: number[]; // repository ids to exclude
  saved: string[]; // ids of the active saved searches
}

const LIST_KEYS = new Set(["repo", "notRepo", "saved"]);

function readIds(params: URLSearchParams, key: string): number[] {
  return (params.get(key) ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function readFilters(params: URLSearchParams): TaskFilters {
  const bools = Object.fromEntries(
    Object.entries(BOOL_DEFAULTS).map(([key, def]) => [key, params.has(key) ? params.get(key) === "1" : def]),
  ) as Record<BoolFilter, boolean>;
  return {
    ...bools,
    q: params.get("q") ?? "",
    repo: readIds(params, "repo"),
    notRepo: readIds(params, "notRepo"),
    saved: (params.get("saved") ?? "").split(",").filter(Boolean),
  };
}

// Turning one filter of a pair on turns the other off.
const EXCLUSIVE_PAIRS: [BoolFilter, BoolFilter][] = [
  ["sprint", "backlog"],
  ["hideIdle", "idleOnly"],
];

/** Only non-default values are written, so a default view is a bare /tasks. */
export function writeFilters(params: URLSearchParams, patch: Partial<TaskFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  const changes = { ...patch };
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    if (patch[a]) changes[b] = false;
    if (patch[b]) changes[a] = false;
  }
  for (const [key, value] of Object.entries(changes)) {
    if (key in BOOL_DEFAULTS) {
      if (value === BOOL_DEFAULTS[key as BoolFilter]) next.delete(key);
      else next.set(key, value ? "1" : "0");
    } else if (LIST_KEYS.has(key)) {
      const ids = value as (string | number)[];
      if (ids.length) next.set(key, ids.join(","));
      else next.delete(key);
    } else if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }
  return next;
}

/** A repo badge click cycles it: off → include → exclude → off. */
export function cycleRepo(filters: Pick<TaskFilters, "repo" | "notRepo">, id: number): Pick<TaskFilters, "repo" | "notRepo"> {
  const repo = filters.repo.filter((r) => r !== id);
  const notRepo = filters.notRepo.filter((r) => r !== id);
  if (filters.repo.includes(id)) return { repo, notRepo: [...notRepo, id] };
  if (filters.notRepo.includes(id)) return { repo, notRepo };
  return { repo: [...repo, id], notRepo };
}

export function repoState(filters: Pick<TaskFilters, "repo" | "notRepo">, id: number): "include" | "exclude" | "off" {
  if (filters.repo.includes(id)) return "include";
  if (filters.notRepo.includes(id)) return "exclude";
  return "off";
}

const LAST_SEARCH_KEY = "tasksPage.lastSearch";

function storeLastSearch(search: string) {
  localStorage.setItem(LAST_SEARCH_KEY, search);
}

export function useTaskFilters(): [TaskFilters, (patch: Partial<TaskFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const search = params.toString();

  // A bare /tasks (sidebar, "back to tasks" link) reopens the last filters instead of the defaults.
  useEffect(() => {
    if (search) return storeLastSearch(search);
    const last = localStorage.getItem(LAST_SEARCH_KEY);
    if (last) setParams(new URLSearchParams(last), { replace: true });
  }, [search, setParams]);

  const update = useCallback(
    (patch: Partial<TaskFilters>) => {
      const next = writeFilters(params, patch).toString();
      if (next === search) return; // no duplicate history entry
      storeLastSearch(next); // so resetting to the defaults isn't undone by the restore above
      setParams(new URLSearchParams(next));
    },
    [params, search, setParams],
  );

  return [readFilters(params), update];
}
