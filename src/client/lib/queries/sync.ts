import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SyncRunResult, Task, TaskSyncResult } from "@/shared/types";
import { taskKeys } from "./tasks";
import { choreKeys } from "./chores";

const nextSyncKey = ["sync", "next"] as const;

/** When the server's next auto sync pass starts; null while its scheduler is off. */
export function useNextSyncQuery() {
  return useQuery({
    queryKey: nextSyncKey,
    queryFn: () => api.get<{ nextSyncAt: string | null }>("/sync/next"),
    // Refetch just after the pass starts, to pick up the one after it.
    refetchInterval: (query) => {
      const at = query.state.data?.nextSyncAt;
      return at ? Math.max(Date.parse(at) - Date.now() + 1000, 5000) : 60_000;
    },
  });
}

/** One full sync pass on the server; joins the pass already running, if any. */
export function useSyncAll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<SyncRunResult>("/sync"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: choreKeys.list() });
    },
    onSettled: () => {
      // The server restarts its countdown after the pass.
      queryClient.invalidateQueries({ queryKey: nextSyncKey });
    },
  });
}

/** Re-pull one task from Jira, GitHub and its worktree; `errors` names each source that failed. */
export function useSyncTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: number) => api.post<TaskSyncResult>(`/tasks/${taskId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: choreKeys.list() });
    },
  });
}

export interface SyncVisibleProgress {
  current: number;
  total: number;
}

/** Re-pull the tasks one after another. Each error is prefixed with its task's Jira key, else its title. */
export function useSyncVisibleTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tasks,
      onProgress,
    }: {
      tasks: Task[];
      onProgress?: (progress: SyncVisibleProgress) => void;
    }) => {
      const errors: string[] = [];
      for (const [i, task] of tasks.entries()) {
        onProgress?.({ current: i + 1, total: tasks.length });
        const result = await api.post<TaskSyncResult>(`/tasks/${task.id}/sync`);
        errors.push(...result.errors.map((error) => `${task.jiraKey ?? task.title}: ${error}`));
      }
      return { errors };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: choreKeys.list() });
    },
  });
}
