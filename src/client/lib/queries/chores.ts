import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export interface ChoreDefinition {
  number: number;
  name: string;
  condition: string;
  prompt: string;
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
  isCustom?: boolean;
}

export const choreKeys = {
  all: ["chores"] as const,
  definitions: () => [...choreKeys.all, "definitions"] as const,
  list: () => [...choreKeys.all, "list"] as const,
  next: () => [...choreKeys.all, "next"] as const,
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

export function useNextChoreQuery(sprintView?: boolean) {
  return useQuery({
    queryKey: [...choreKeys.next(), { sprintView }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sprintView !== undefined) params.set("sprintView", String(sprintView));
      const query = params.toString();
      return api.get<ChoreEntry | null>(`/chores/next${query ? `?${query}` : ""}`);
    },
  });
}
