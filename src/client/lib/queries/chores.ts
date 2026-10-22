import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ChoreDefinition, ChoreEntry } from "@/shared/chores";

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
