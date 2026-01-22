import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Repository, ListResponse } from "../types";

export const repositoryKeys = {
  all: ["repositories"] as const,
  lists: () => [...repositoryKeys.all, "list"] as const,
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
    mutationFn: (data: { owner: string; repo: string; enabled?: boolean; badgeColor?: string | null }) =>
      api.post<Repository>("/repositories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.lists() });
    },
  });
}

export function useUpdateRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; owner?: string; repo?: string; enabled?: boolean; badgeColor?: string | null; deploymentBranches?: string[]; localPath?: string | null }) =>
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
