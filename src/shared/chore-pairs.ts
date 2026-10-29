/**
 * A multi-repo chore's repositories by name, in ship order: each upstream PR ships before the
 * repos after it pick up its release, and the last one is the target.
 */
export type RepoPair = [...upstreams: string[], target: string];

/**
 * Order a selection for a multi-repo chore: `[targetId, ...upstreamIds in ship order]` when the
 * selection is exactly one task per repository of one of the pairs, in any order; null
 * otherwise. The session runs on the target task.
 */
export function orderForRepoPair(pairs: RepoPair[], tasks: { id: number; repo: string | null }[]): number[] | null {
  for (const pair of pairs) {
    if (tasks.length !== pair.length) continue;
    const ids = pair.map((repo) => tasks.find((t) => t.repo === repo)?.id);
    if (ids.some((id) => id === undefined)) continue;
    const target = ids.pop() as number;
    return [target, ...(ids as number[])];
  }
  return null;
}
