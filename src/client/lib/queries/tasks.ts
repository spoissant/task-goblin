import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Task, TaskDetail, TaskWithRepository, ListResponse, AutoMatchResult, SplitResult } from "../types";

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: { status?: string }) => [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: number) => [...taskKeys.details(), id] as const,
  withRelations: () => [...taskKeys.all, "with-relations"] as const,
  orphanJira: () => [...taskKeys.all, "orphan-jira"] as const,
  orphanPr: () => [...taskKeys.all, "orphan-pr"] as const,
};

export function useTasksQuery(filters: { status?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();

  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => api.get<ListResponse<Task>>(`/tasks${query ? `?${query}` : ""}`),
  });
}

export function useTaskQuery(id: number) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
    enabled: id > 0,
  });
}

// Linked tasks: manual + merged (for curation view top section)
export function useTasksWithRelationsQuery() {
  return useQuery({
    queryKey: taskKeys.withRelations(),
    queryFn: () => api.get<ListResponse<TaskWithRepository>>("/tasks/with-relations"),
  });
}

// Orphan Jira tasks: jiraKey set, no prNumber
export function useOrphanJiraTasksQuery() {
  return useQuery({
    queryKey: taskKeys.orphanJira(),
    queryFn: () => api.get<ListResponse<Task>>("/tasks/orphan-jira"),
  });
}

// Orphan PR tasks: prNumber set, no jiraKey
export function useOrphanPrTasksQuery() {
  return useQuery({
    queryKey: taskKeys.orphanPr(),
    queryFn: () => api.get<ListResponse<TaskWithRepository>>("/tasks/orphan-pr"),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title: string; description?: string; status?: string }) =>
      api.post<Task>("/tasks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; description?: string; status?: string }) =>
      api.patch<Task>(`/tasks/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.id) });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

// Merge two orphan tasks (jira + pr)
export function useMergeTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: number; sourceId: number }) =>
      api.post<Task>(`/tasks/${targetId}/merge`, { sourceTaskId: sourceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

// Split a merged task back into two orphans
export function useSplitTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<SplitResult>(`/tasks/${id}/split`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

// Auto-match orphans
export function useAutoMatchOrphans() {
  return useMutation({
    mutationFn: () => api.post<AutoMatchResult>("/tasks/auto-match"),
  });
}

// Batch merge multiple task pairs
export function useBatchMergeTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pairs: Array<{ targetId: number; sourceId: number }>) => {
      const results = await Promise.all(
        pairs.map(({ targetId, sourceId }) =>
          api.post<Task>(`/tasks/${targetId}/merge`, { sourceTaskId: sourceId })
        )
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
