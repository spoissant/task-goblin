import { parseStringList } from "./json";

// The manual dev QA step: a clean Code Review PR, live on its test envs, waits
// on the user to QA it and move its ticket to Ready for Test.

/** The status category the step starts from. */
export const DEV_QA_CATEGORY = "Code Review";
/** The Jira status the ticket moves to once QA'd. */
export const READY_FOR_TEST = "Ready for Test";

interface DevQaFields {
  prState: string | null;
  isDraft: number | null;
  checksStatus: string | null;
  unresolvedCommentCount: number | null;
  hasConflicts: number | null;
  onDeploymentBranches: string | null;
  labelOnlyDeploymentBranches: string | null;
  deployedOnBranches: string | null;
}

/**
 * The PR side of the step, status aside: open, not a draft, checks green, no
 * unresolved comments or conflicts, and live on every env it went to. Each env
 * it is merged into or labelled for must serve its head: one still rolling
 * out, or behind the PR (labelled, but missing its latest commits), holds it.
 * Reviews don't matter.
 */
export function isDevQaReady(task: DevQaFields): boolean {
  const merged = parseStringList(task.onDeploymentBranches);
  const deployed = parseStringList(task.deployedOnBranches);
  const envs = new Set([...merged, ...parseStringList(task.labelOnlyDeploymentBranches)]);
  return (
    task.prState === "open" &&
    task.isDraft === 0 &&
    task.checksStatus === "passing" &&
    (task.unresolvedCommentCount ?? 0) === 0 &&
    (task.hasConflicts ?? 0) === 0 &&
    envs.size > 0 &&
    [...envs].every((env) => merged.includes(env) && deployed.includes(env))
  );
}
