import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SyncResult, MatchResult, Task, Repository } from "../types";
import { taskKeys } from "./tasks";

export type SyncStep = "jira" | "github" | "matching";

export interface SyncOptions {
  onStepChange?: (step: SyncStep | null) => void;
}

export function useSyncMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<MatchResult>("/sync/match"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useSyncJira(options?: SyncOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      options?.onStepChange?.("jira");
      const jiraResult = await api.post<SyncResult>("/sync/jira");

      options?.onStepChange?.("matching");
      const matchResult = await api.post<MatchResult>("/sync/match");

      return { ...jiraResult, merged: matchResult.merged };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onSettled: () => {
      options?.onStepChange?.(null);
    },
  });
}

export function useSyncGitHub(options?: SyncOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      options?.onStepChange?.("github");
      const githubResult = await api.post<SyncResult>("/sync/github");

      options?.onStepChange?.("matching");
      const matchResult = await api.post<MatchResult>("/sync/match");

      return { ...githubResult, merged: matchResult.merged };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onSettled: () => {
      options?.onStepChange?.(null);
    },
  });
}

interface SyncAllResult {
  jira?: SyncResult;
  github?: SyncResult;
  merged?: number;
}

export function useSyncAll(options?: SyncOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<SyncAllResult> => {
      const results: SyncAllResult = {};

      options?.onStepChange?.("jira");
      try {
        results.jira = await api.post<SyncResult>("/sync/jira");
      } catch {
        // Jira sync failed, continue with GitHub
      }

      options?.onStepChange?.("github");
      try {
        results.github = await api.post<SyncResult>("/sync/github");
      } catch {
        // GitHub sync failed
      }

      options?.onStepChange?.("matching");
      try {
        const matchResult = await api.post<MatchResult>("/sync/match");
        results.merged = matchResult.merged;
      } catch {
        // Match failed
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onSettled: () => {
      options?.onStepChange?.(null);
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
          results.jira = await api.post<{ status: "new" | "updated" }>(`/sync/jira/${task.jiraKey}`);
        } catch {
          // Jira sync failed, continue
        }
      }

      // Sync GitHub if task has PR
      if (task.prNumber && repo) {
        try {
          results.github = await api.post<{ task: Task }>(
            `/sync/github/${repo.owner}/${repo.repo}/${task.prNumber}`
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
