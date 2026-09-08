import type { StatusCategory } from "./types";

/**
 * Task Goblin stores the raw Jira status on the task (e.g. "Ready to Prod",
 * "Code review") plus a few legacy snake_case values from before the status
 * migration ("code_review", "done"). status_categories maps those onto the
 * seven workflow columns. Matching is case-insensitive and tolerates
 * snake_case so legacy rows land in the right column.
 */

const normalise = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();

export interface CategoryResolver {
  categories: StatusCategory[];
  resolve(status: string | null): StatusCategory | null;
}

export function buildCategoryResolver(
  rows: { name: string; done: number; display_order: number; jira_mappings: string | null }[],
): CategoryResolver {
  const categories: StatusCategory[] = rows.map((r) => ({
    name: r.name,
    done: r.done === 1,
    order: r.display_order,
  }));

  const lookup = new Map<string, StatusCategory>();
  for (const [i, row] of rows.entries()) {
    const cat = categories[i]!;
    // The category's own name is a valid status value too.
    lookup.set(normalise(row.name), cat);
    let mappings: unknown = [];
    try {
      mappings = row.jira_mappings ? JSON.parse(row.jira_mappings) : [];
    } catch {
      mappings = [];
    }
    if (Array.isArray(mappings)) {
      for (const m of mappings) {
        if (typeof m === "string") lookup.set(normalise(m), cat);
      }
    }
  }

  return {
    categories,
    resolve(status) {
      if (!status) return null;
      return lookup.get(normalise(status)) ?? null;
    },
  };
}

/** Blocked is a side-state, not a stage — it sits last in display_order but
 *  moving into it is not "progress backwards through the pipeline". */
export const isBlockedCategory = (c: StatusCategory | null | undefined) =>
  !!c && normalise(c.name) === "blocked";
