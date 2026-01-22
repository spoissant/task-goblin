import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { DeployResult, BulkDeployResult } from "../types";
import { taskKeys } from "./tasks";
import { logKeys } from "./logs";

interface DeployConflictResponse {
  error: {
    code: "MERGE_CONFLICT";
    message: string;
    details: {
      conflictedFiles: string[];
    };
  };
}

export type DeployMutationResult =
  | { success: true; data: DeployResult }
  | { success: false; conflict: true; conflictedFiles: string[] };

export function useDeployBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      targetBranch,
    }: {
      taskId: number;
      targetBranch: string;
    }): Promise<DeployMutationResult> => {
      try {
        const data = await api.post<DeployResult>(`/deploy/${taskId}`, { targetBranch });
        return { success: true, data };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === "MERGE_CONFLICT") {
          // Fetch the full error response to get conflict details
          const response = await fetch(`/api/v1/deploy/${taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetBranch }),
          });
          const body = await response.json() as DeployConflictResponse;
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

export function useBulkDeploy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskIds,
      targetBranch,
    }: {
      taskIds: number[];
      targetBranch: string;
    }) => api.post<BulkDeployResult>("/deploy/bulk", { taskIds, targetBranch }),
    onSuccess: (_, { taskIds }) => {
      // Invalidate all affected tasks
      for (const taskId of taskIds) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      }
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: logKeys.all });
    },
  });
}
