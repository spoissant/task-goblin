import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { DevStack, DevStackOverview } from "../types";

export const devStackKeys = {
  all: ["dev-stack"] as const,
};

const BUSY_STATES = new Set(["starting", "stopping"]);

/** The one dev stack and which repositories support it; shared by every row. */
export function useDevStackOverviewQuery() {
  return useQuery({
    queryKey: devStackKeys.all,
    queryFn: () => api.get<DevStackOverview>("/dev-stack"),
    // Keep liveness fresh while a stack exists.
    refetchInterval: (query) => {
      const state = query.state.data?.stack?.state;
      if (!state) return false;
      return BUSY_STATES.has(state) ? 2_000 : 10_000;
    },
  });
}

export function useBootDevStack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => api.post<DevStack>(`/tasks/${taskId}/dev-stack`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: devStackKeys.all }),
  });
}

export function useStopDevStack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => api.delete<DevStack>(`/tasks/${taskId}/dev-stack`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: devStackKeys.all }),
  });
}
