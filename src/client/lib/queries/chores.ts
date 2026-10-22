import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { RepoPair } from "@/shared/chore-pairs";

export interface ChoreDefinition {
  number: number;
  key: string;
  name: string;
  condition: string;
  prompt: string;
  supportsBulk: boolean;
  requiresSameRepo: boolean;
  /** Two-repo chore: offered only for one task per repo of a pair. */
  repoPairs: RepoPair[] | null;
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
  repository: { owner: string; repo: string } | null;
}

export interface ChoreEntry {
  number: number;
  key: string;
  name: string;
  prompt: string;
  task: ChoreTask;
}

/** Fill a chore prompt template for a task. Mirrors the server's resolvePrompt. */
export function resolveChorePrompt(template: string, task: { id: number; jiraKey: string | null }): string {
  return template.replace("{{taskId}}", String(task.id)).replace("{{jiraKey}}", task.jiraKey ?? "");
}

export const choreKeys = {
  all: ["chores"] as const,
  definitions: () => [...choreKeys.all, "definitions"] as const,
  list: () => [...choreKeys.all, "list"] as const,
};

export function useChoresQuery() {
  return useQuery({
    queryKey: choreKeys.list(),
    queryFn: () => api.get<{ items: ChoreEntry[] }>("/chores"),
    staleTime: 30_000,
  });
}

export function useChoreDefinitionsQuery() {
  return useQuery({
    queryKey: choreKeys.definitions(),
    queryFn: () => api.get<{ items: ChoreDefinition[] }>("/chores/definitions"),
    staleTime: Infinity,
  });
}
