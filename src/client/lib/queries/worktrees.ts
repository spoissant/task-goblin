import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { RepositoryGuess, TaskWorktreeStatus } from "../types";

export const worktreeKeys = {
  all: ["worktree"] as const,
  task: (taskId: number) => [...worktreeKeys.all, taskId] as const,
  guess: (taskId: number) => ["repository-guess", taskId] as const,
};

export function useTaskWorktreeQuery(taskId: number) {
  return useQuery({
    queryKey: worktreeKeys.task(taskId),
    queryFn: () => api.get<TaskWorktreeStatus | null>(`/tasks/${taskId}/worktree`),
    enabled: taskId > 0,
  });
}

export function useRemoveTaskWorktree() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, force }: { taskId: number; force?: boolean }) =>
      api.delete<TaskWorktreeStatus>(`/tasks/${taskId}/worktree${force ? "?force=true" : ""}`),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: worktreeKeys.task(taskId) });
    },
  });
}

export function useRepositoryGuessQuery(taskId: number, enabled: boolean) {
  return useQuery({
    queryKey: worktreeKeys.guess(taskId),
    queryFn: () => api.get<RepositoryGuess>(`/tasks/${taskId}/repository-guess`),
    enabled: enabled && taskId > 0,
    staleTime: 60_000,
  });
}
