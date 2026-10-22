import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Task, TaskDetail, TaskListItem, ListResponse, PaginatedResponse } from "../types";
import { choreKeys } from "./chores";

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: { title?: string }) => [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: number) => [...taskKeys.details(), id] as const,
  completed: (pagination: { limit: number; offset: number; showDone?: boolean; title?: string }) => [...taskKeys.all, "completed", pagination] as const,
};

export function useTasksQuery(filters: { title?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.title) params.set("title", filters.title);
  const query = params.toString();

  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => api.get<ListResponse<TaskListItem>>(`/tasks${query ? `?${query}` : ""}`),
  });
}

// Completed tasks with pagination
export function useCompletedTasksQuery({ limit = 25, offset = 0, showDone = false, title }: { limit?: number; offset?: number; showDone?: boolean; title?: string } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), showDone: String(showDone) });
  if (title) params.set("title", title);
  return useQuery({
    queryKey: taskKeys.completed({ limit, offset, showDone, title }),
    queryFn: () => api.get<PaginatedResponse<TaskDetail>>(`/tasks/completed?${params}`),
  });
}

export function useTaskQuery(id: number) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
    enabled: id > 0,
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
    mutationFn: ({ id, ...data }: { id: number; title?: string; description?: string; status?: string; highPriority?: boolean; onIce?: boolean; onIceReason?: string | null; choreSkips?: string; repositoryId?: number | null }) =>
      api.patch<Task>(`/tasks/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: choreKeys.all });
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

// Manually assign a PR URL to an existing task
export function useAssignPr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, url }: { id: number; url: string }) =>
      api.post<Task>(`/tasks/${id}/assign-pr`, { url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

// Manually assign a Jira key to a PR task
export function useAssignJira() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, key }: { id: number; key: string }) =>
      api.post<Task>(`/tasks/${id}/assign-jira`, { key }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

// Squash-merge a PR the merge gate cleared (the Merge button)
export function useMergePr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Task>(`/tasks/${id}/merge-pr`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
