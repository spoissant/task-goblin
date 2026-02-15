import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Prompt, ListResponse } from "../types";

export const promptKeys = {
  all: ["prompts"] as const,
  forRepo: (repositoryId: number) => [...promptKeys.all, "repo", repositoryId] as const,
  detail: (id: number) => [...promptKeys.all, "detail", id] as const,
};

export function usePromptQuery(id: number, enabled = true) {
  return useQuery({
    queryKey: promptKeys.detail(id),
    queryFn: () => api.get<Prompt>(`/prompts/${id}`),
    enabled: id > 0 && enabled,
  });
}

export function usePromptsQuery(repositoryId: number) {
  return useQuery({
    queryKey: promptKeys.forRepo(repositoryId),
    queryFn: () =>
      api.get<ListResponse<Prompt>>(`/repositories/${repositoryId}/prompts`),
    enabled: repositoryId > 0,
  });
}

export function useCreatePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      repositoryId,
      ...data
    }: {
      repositoryId: number;
      content: string;
      taskId?: number;
      position?: number;
      permissionMode?: string;
    }) => api.post<Prompt>(`/repositories/${repositoryId}/prompts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}

export function useCancelPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Prompt>(`/prompts/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}

export function useRespondToPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: number;
      approved: boolean;
      message?: string;
    }) => api.post<Prompt>(`/prompts/${id}/respond`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}

export function useRetryPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Prompt>(`/prompts/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}

export function useDeletePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/prompts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}

export function useUpdatePromptPermissionMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, permissionMode }: { id: number; permissionMode: string }) =>
      api.patch<Prompt>(`/prompts/${id}`, { permissionMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}

export function useUpdatePromptPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, position }: { id: number; position: number }) =>
      api.patch<Prompt>(`/prompts/${id}`, { position }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.all });
    },
  });
}
