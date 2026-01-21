import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SyncResult, Task, Repository } from "../types";
import { taskKeys } from "./tasks";

export function useSyncJira() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<SyncResult>("/sync/jira"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useSyncGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<SyncResult>("/sync/github"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

interface SyncAllResult {
  jira?: SyncResult;
  github?: SyncResult;
}

export function useSyncAll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<SyncAllResult> => {
      const results: SyncAllResult = {};

      try {
        results.jira = await api.post<SyncResult>("/sync/jira");
      } catch {
        // Jira sync failed, continue with GitHub
      }

      try {
        results.github = await api.post<SyncResult>("/sync/github");
      } catch {
        // GitHub sync failed
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

interface SyncTaskParams {
  task: Task;
  repo?: Repository;
}

interface SingleSyncResult {
  jira?: { status: "new" | "updated" };
  github?: { task: Task };
}

export function useSyncTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ task, repo }: SyncTaskParams): Promise<SingleSyncResult> => {
      const results: SingleSyncResult = {};

      // Sync Jira if task has jiraKey
      if (task.jiraKey) {
        try {
          results.jira = await api.post<{ status: "new" | "updated" }>(`/refresh/jira/${task.jiraKey}`);
        } catch {
          // Jira sync failed, continue
        }
      }

      // Sync GitHub if task has PR
      if (task.prNumber && repo) {
        try {
          results.github = await api.post<{ task: Task }>(
            `/refresh/github/${repo.owner}/${repo.repo}/${task.prNumber}`
          );
        } catch {
          // GitHub sync failed
        }
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
