import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export interface ChoreDefinition {
  number: number;
  name: string;
  condition: string;
  prompt: string;
}

export const choreKeys = {
  all: ["chores"] as const,
  definitions: () => [...choreKeys.all, "definitions"] as const,
};

export function useChoreDefinitionsQuery() {
  return useQuery({
    queryKey: choreKeys.definitions(),
    queryFn: () => api.get<{ items: ChoreDefinition[] }>("/chores/definitions"),
    staleTime: Infinity, // definitions never change at runtime
  });
}
