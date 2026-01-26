import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { SyncResult, MatchResult, Task, Repository, SyncBranchResult } from "../types";
import { taskKeys } from "./tasks";
import { logKeys } from "./logs";

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

// Sync branch types
interface SyncBranchConflictResponse {
  error: {
    code: "MERGE_CONFLICT";
    message: string;
    details: {
      conflictedFiles: string[];
    };
  };
}

export type SyncBranchMutationResult =
  | { success: true; data: SyncBranchResult }
  | { success: false; conflict: true; conflictedFiles: string[] };

/**
 * Sync a task's feature branch with the latest changes from the main branch.
 * This merges the base branch (e.g., main) into the task's head branch.
 */
export function useSyncBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
    }: {
      taskId: number;
    }): Promise<SyncBranchMutationResult> => {
      try {
        const data = await api.post<SyncBranchResult>(`/sync-branch/${taskId}`);
        return { success: true, data };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === "MERGE_CONFLICT") {
          // Fetch the full error response to get conflict details
          const response = await fetch(`/api/v1/sync-branch/${taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const body = await response.json() as SyncBranchConflictResponse;
          return {
            success: false,
            conflict: true,
            conflictedFiles: body.error.details.conflictedFiles,
          };
        }
        throw err;
      }
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: logKeys.all });
    },
  });
}
