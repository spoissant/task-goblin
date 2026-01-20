import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlockedBy } from "../types";
import { taskKeys } from "./tasks";

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
    },
  });
}

export function useDeleteBlocker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/blocked-by/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.details() });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}
