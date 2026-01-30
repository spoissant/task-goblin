import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlockedBy, ListResponse } from "../types";
import { taskKeys } from "./tasks";

export const blockerKeys = {
  all: ["blockers"] as const,
  byTask: (taskId: number) => [...blockerKeys.all, "byTask", taskId] as const,
};

export function useBlockersQuery(taskId: number) {
  return useQuery({
    queryKey: blockerKeys.byTask(taskId),
    queryFn: () => api.get<ListResponse<BlockedBy>>(`/blocked-by?blockedTaskId=${taskId}`),
  });
}

export function useCreateBlocker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      blockedTaskId: number;
      blockerTaskId?: number;
      blockerTodoId?: number;
    }) => api.post<BlockedBy>("/blocked-by", data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.blockedTaskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: blockerKeys.byTask(variables.blockedTaskId) });
    },
  });
}

export function useDeleteBlocker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, blockedTaskId }: { id: number; blockedTaskId: number }) => api.delete(`/blocked-by/${id}`),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.details() });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: blockerKeys.byTask(variables.blockedTaskId) });
    },
  });
}
