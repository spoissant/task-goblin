import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Todo, TodoWithTask, ListResponse } from "../types";
import { taskKeys } from "./tasks";

export const todoKeys = {
  all: ["todos"] as const,
  list: () => [...todoKeys.all, "list"] as const,
  listFiltered: (params: { taskId?: number; done?: boolean }) =>
    [...todoKeys.list(), params] as const,
};

export function useTodosQuery(params: { taskId?: number; done?: boolean } = {}) {
  const searchParams = new URLSearchParams();
  if (params.taskId !== undefined) {
    searchParams.set("taskId", String(params.taskId));
  }
  if (params.done !== undefined) {
    searchParams.set("done", String(params.done));
  }
  const queryString = searchParams.toString();
  const url = queryString ? `/todos?${queryString}` : "/todos";

  return useQuery({
    queryKey: todoKeys.listFiltered(params),
    queryFn: () => api.get<ListResponse<TodoWithTask>>(url),
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { content: string; taskId?: number; placement?: "start" | "end" }) =>
      api.post<Todo>("/todos", data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      if (variables.taskId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.taskId) });
      }
    },
  });
}

export function useToggleTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Todo>(`/todos/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; content?: string }) =>
      api.patch<Todo>(`/todos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.details() });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/todos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useReorderTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, position }: { id: number; position: number }) =>
      api.put<Todo>(`/todos/${id}/reorder`, { position }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useSkipTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Todo>(`/todos/${id}/skip`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function usePendingTodoCountQuery() {
  const { data } = useTodosQuery({ done: false });
  return data?.total ?? 0;
}

export function useCurrentTodo() {
  const { data, isLoading } = useTodosQuery({ done: false });

  const currentTodo = (() => {
    if (!data?.items) return null;

    // Apply grouping logic: non-task todos always included, first undone todo per task only
    const seenTasks = new Set<number>();
    const grouped = data.items.filter((todo) => {
      if (!todo.taskId) return true;
      if (seenTasks.has(todo.taskId)) return false;
      seenTasks.add(todo.taskId);
      return true;
    });

    // Return first item (already sorted by position from API)
    return grouped[0] ?? null;
  })();

  return { currentTodo, isLoading };
}
