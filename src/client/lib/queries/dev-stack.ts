import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { DevStack, DevStackStatus } from "../types";

export const devStackKeys = {
  all: ["dev-stack"] as const,
  task: (taskId: number) => [...devStackKeys.all, taskId] as const,
};

const BUSY_STATES = new Set(["starting", "stopping"]);

export function useDevStackQuery(taskId: number) {
  return useQuery({
    queryKey: devStackKeys.task(taskId),
    queryFn: () => api.get<DevStackStatus>(`/tasks/${taskId}/dev-stack`),
    enabled: taskId > 0,
    // Keep the log tail and liveness fresh while something is happening.
    refetchInterval: (query) => {
      const state = query.state.data?.stack?.state;
      if (!state) return false;
      return BUSY_STATES.has(state) ? 2_000 : 5_000;
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
