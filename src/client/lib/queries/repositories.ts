import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Repository, ListResponse } from "../types";

const repositoryKeys = {
  all: ["repositories"] as const,
  lists: () => [...repositoryKeys.all, "list"] as const,
};

// Text fields the Settings page edits; null clears them.
type RepositoryText = "alias" | "localPath" | "badgeColor" | "slackChannel" | "setupCommand" | "teardownCommand" | "defaultBaseBranch";

export type RepositoryUpdate = Partial<Pick<Repository, "owner" | "repo" | RepositoryText>> & {
  enabled?: boolean;
  deploymentBranches?: string[];
  deploymentUrls?: Record<string, string> | null;
};

export function useRepositoriesQuery() {
  return useQuery({
    queryKey: repositoryKeys.lists(),
    queryFn: () => api.get<ListResponse<Repository>>("/repositories"),
  });
}

export function useCreateRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { owner: string; repo: string } & RepositoryUpdate) =>
      api.post<Repository>("/repositories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
    },
  });
}

export function useUpdateRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & RepositoryUpdate) =>
      api.patch<Repository>(`/repositories/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
    },
  });
}

export function useDeleteRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/repositories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
    },
  });
}
