import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Task, TaskDetail, TaskWithRepository, TaskWithTodos, ListResponse, PaginatedResponse, SplitResult } from "../types";
import { choreKeys } from "./chores";

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: { status?: string; excludeCompleted?: boolean; title?: string }) => [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: number) => [...taskKeys.details(), id] as const,
  withRelations: () => [...taskKeys.all, "with-relations"] as const,
  orphanJira: () => [...taskKeys.all, "orphan-jira"] as const,
  orphanPr: () => [...taskKeys.all, "orphan-pr"] as const,
  completed: (pagination: { limit: number; offset: number; showDone?: boolean; title?: string }) => [...taskKeys.all, "completed", pagination] as const,
};

export function useTasksQuery(filters: { status?: string; excludeCompleted?: boolean; title?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  // excludeCompleted defaults to true on backend, only pass if explicitly false
  if (filters.excludeCompleted === false) params.set("excludeCompleted", "false");
  if (filters.title) params.set("title", filters.title);
  const query = params.toString();

  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => api.get<ListResponse<TaskWithTodos>>(`/tasks${query ? `?${query}` : ""}`),
  });
}

// Completed tasks with pagination
export function useCompletedTasksQuery({ limit = 25, offset = 0, showDone = false, title }: { limit?: number; offset?: number; showDone?: boolean; title?: string } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), showDone: String(showDone) });
  if (title) params.set("title", title);
  return useQuery({
    queryKey: taskKeys.completed({ limit, offset, showDone, title }),
    queryFn: () => api.get<PaginatedResponse<TaskWithRepository>>(`/tasks/completed?${params}`),
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
    mutationFn: ({ id, ...data }: { id: number; title?: string; description?: string; status?: string; highPriority?: boolean; onIce?: boolean; onIceReason?: string | null; choreSkips?: string }) =>
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

