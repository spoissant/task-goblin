import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentWithWorktree, Agent, ListResponse } from "../types";

export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
};

export function useAgentsQuery() {
  return useQuery({
    queryKey: agentKeys.lists(),
    queryFn: () => api.get<ListResponse<AgentWithWorktree>>("/agents"),
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      worktreeId: number;
      model?: string | null;
      systemPrompt?: string | null;
      maxTurns?: number | null;
      defaultBranch?: string | null;
      allowedTools?: string[] | null;
    }) => api.post<Agent>("/agents", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: number;
      name?: string;
      model?: string | null;
      systemPrompt?: string | null;
      maxTurns?: number | null;
      defaultBranch?: string | null;
      allowedTools?: string[] | null;
    }) => api.patch<Agent>(`/agents/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<AgentWithWorktree>(`/agents/${id}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<AgentWithWorktree>(`/agents/${id}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useCheckAgent() {
  return useMutation({
    mutationFn: (id: number) => api.post(`/agents/${id}/check`),
  });
}
