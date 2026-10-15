/** A two-repo chore's repositories by name: the upstream PR ships first, then the target PR picks up its release. */
export type RepoPair = [upstream: string, target: string];

/**
 * Order a two-task selection for a two-repo chore: `[targetId, upstreamId]`
 * when the tasks' repositories match one of the pairs, in either order; null
 * otherwise. The session runs on the target task.
 */
export function orderForRepoPair(
  pairs: RepoPair[],
  tasks: { id: number; repo: string | null }[],
): [number, number] | null {
  if (tasks.length !== 2) return null;
  const [a, b] = tasks;
  for (const [upstream, target] of pairs) {
    if (a.repo === upstream && b.repo === target) return [b.id, a.id];
    if (a.repo === target && b.repo === upstream) return [a.id, b.id];
  }
  return null;
}
