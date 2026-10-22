// Chores as the API serves them (GET /api/v1/chores, /chores/definitions), and
// how a chore's prompt template is filled for a task.
import type { RepoPair } from "./chore-pairs";

export interface ChoreDefinition {
  number: number;
  key: string;
  name: string;
  condition: string;
  prompt: string; // template: {{taskId}}, {{jiraKey}}
  supportsBulk: boolean;
  requiresSameRepo: boolean;
  /** Two-repo chore: offered only for one task per repo of a pair. */
  repoPairs: RepoPair[] | null;
  /** The chore scheduler starts it on its own. */
  auto: boolean;
}

export interface ChoreTask {
  id: number;
  title: string;
  jiraKey: string | null;
  sprint: string | null;
  prNumber: number | null;
  headBranch: string | null;
  baseBranch: string | null;
  status: string;
  highPriority: number | null;
  repository: { owner: string; repo: string } | null;
}

/** A chore a task is due for. */
export interface ChoreEntry {
  number: number;
  key: string;
  name: string;
  prompt: string;
  task: ChoreTask;
}

/** Fill a chore prompt template. `taskIds` stands in for `{{taskId}}` on a bulk run. */
export function resolvePrompt(template: string, task: { id: number; jiraKey: string | null }, taskIds?: number[]): string {
  return template
    .replace("{{taskId}}", (taskIds ?? [task.id]).join(" "))
    .replace("{{jiraKey}}", task.jiraKey ?? "");
}
