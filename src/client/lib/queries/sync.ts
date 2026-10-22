import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { SyncResult, MatchResult, Task, Repository } from "../types";
import { taskKeys } from "./tasks";
import { choreKeys } from "./chores";


export type SyncStep = "jira" | "github" | "matching";

const nextSyncKey = ["sync", "next"] as const;

export interface SyncOptions {
  onStepChange?: (step: SyncStep | null) => void;
}

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

export interface SyncStepFailure {
  step: SyncStep;
  message: string;
}

interface SyncAllResult {
  jira?: SyncResult;
  github?: SyncResult;
  merged?: number;
  failures: SyncStepFailure[];
}

function describeSyncError(err: unknown): string {
  // A rejected fetch (not an ApiError) means the request never reached the
  // server at all, e.g. the backend process isn't running.
  return err instanceof ApiError ? err.message : "Could not reach the server";
}

export function useSyncAll(options?: SyncOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<SyncAllResult> => {
      const results: SyncAllResult = { failures: [] };

      options?.onStepChange?.("jira");
      try {
        results.jira = await api.post<SyncResult>("/sync/jira");
      } catch (err) {
        results.failures.push({ step: "jira", message: describeSyncError(err) });
      }

      options?.onStepChange?.("github");
      try {
        results.github = await api.post<SyncResult>("/sync/github");
      } catch (err) {
        results.failures.push({ step: "github", message: describeSyncError(err) });
      }

      options?.onStepChange?.("matching");
      try {
        const matchResult = await api.post<MatchResult>("/sync/match");
        results.merged = matchResult.merged;
      } catch (err) {
        results.failures.push({ step: "matching", message: describeSyncError(err) });
      }

      // All three steps hit the same server; if every one failed, the
      // backend is unreachable rather than mid-sync — surface it as an error.
      if (results.failures.length === 3) {
        throw new Error(results.failures[0].message);
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: choreKeys.list() });
    },
    onSettled: () => {
      options?.onStepChange?.(null);
      // The server restarts its countdown after the after-sync steps.
      queryClient.invalidateQueries({ queryKey: nextSyncKey });
    },
  });
}

export interface SyncTaskParams {
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
      queryClient.invalidateQueries({ queryKey: choreKeys.list() });
    },
  });
}

export interface SyncVisibleProgress {
  current: number;
  total: number;
}

export function useSyncVisibleTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      items,
      onProgress,
    }: {
      items: SyncTaskParams[];
      onProgress?: (progress: SyncVisibleProgress) => void;
    }) => {
      for (let i = 0; i < items.length; i++) {
        onProgress?.({ current: i + 1, total: items.length });
        const { task, repo } = items[i];

        if (task.jiraKey) {
          try {
            await api.post(`/sync/jira/${task.jiraKey}`);
          } catch {}
        }

        if (task.prNumber && repo) {
          try {
            await api.post(`/sync/github/${repo.owner}/${repo.repo}/${task.prNumber}`);
          } catch {}
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: choreKeys.list() });
    },
  });
}
