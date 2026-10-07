import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { DevStack, DevStackOverview, DevStackOwner, DevStackRefresh } from "../types";

export const devStackKeys = {
  all: ["dev-stack"] as const,
};

const BUSY_STATES = new Set(["starting", "stopping"]);

/** The dev stacks (one per repository) and which repositories support them; shared by every row. */
export function useDevStackOverviewQuery() {
  return useQuery({
    queryKey: devStackKeys.all,
    queryFn: () => api.get<DevStackOverview>("/dev-stack"),
    // Keep liveness fresh while a stack exists.
    refetchInterval: (query) => {
      const stacks = query.state.data?.stacks ?? [];
      if (stacks.length === 0) return false;
      return stacks.some((s) => BUSY_STATES.has(s.state)) ? 2_000 : 10_000;
    },
  });
}

// Task stacks live under the task; task-less PR stacks are addressed by URL.
// withTaskIds merges those tasks' branches on top of the owner task's.
type BootRequest = DevStackOwner & { withTaskIds?: number[] };
const bootStack = ({ withTaskIds, ...owner }: BootRequest) =>
  "taskId" in owner
    ? api.post<DevStack>(`/tasks/${owner.taskId}/dev-stack`, withTaskIds && { withTaskIds })
    : api.post<DevStack>("/dev-stack/pr", owner);
const stopStack = (owner: DevStackOwner) =>
  "taskId" in owner ? api.delete<DevStack>(`/tasks/${owner.taskId}/dev-stack`) : api.post<DevStack>("/dev-stack/pr/stop", owner);
const refreshStack = (owner: DevStackOwner) =>
  "taskId" in owner
    ? api.post<DevStackRefresh>(`/tasks/${owner.taskId}/dev-stack/refresh`)
    : api.post<DevStackRefresh>("/dev-stack/pr/refresh", owner);

export function useBootDevStack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bootStack,
    onSettled: () => queryClient.invalidateQueries({ queryKey: devStackKeys.all }),
  });
}

export function useStopDevStack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: stopStack,
    onSettled: () => queryClient.invalidateQueries({ queryKey: devStackKeys.all }),
  });
}

export function useRefreshDevStack() {
  return useMutation({
    mutationFn: refreshStack,
  });
}
