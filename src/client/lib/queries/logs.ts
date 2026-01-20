import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Log, PaginatedResponse } from "../types";

export const logKeys = {
  all: ["logs"] as const,
  lists: () => [...logKeys.all, "list"] as const,
  list: (filters: { includeRead?: boolean; limit: number; offset: number }) =>
    [...logKeys.lists(), filters] as const,
  unreadCount: () => [...logKeys.all, "unread-count"] as const,
};

export function useLogsQuery({
  includeRead = false,
  limit = 25,
  offset = 0,
}: {
  includeRead?: boolean;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (includeRead) params.set("includeRead", "true");
  params.set("limit", limit.toString());
  params.set("offset", offset.toString());
  const query = params.toString();

  return useQuery({
    queryKey: logKeys.list({ includeRead, limit, offset }),
    queryFn: () => api.get<PaginatedResponse<Log>>(`/logs?${query}`),
  });
}

export function useUnreadCountQuery() {
  return useQuery({
    queryKey: logKeys.unreadCount(),
    queryFn: () => api.get<{ count: number }>("/logs/unread-count"),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useMarkLogRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Log>(`/logs/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logKeys.all });
    },
  });
}

export function useMarkAllLogsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ success: boolean }>("/logs/mark-all-read"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logKeys.all });
    },
  });
}

export function useDeleteLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/logs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logKeys.all });
    },
  });
}
