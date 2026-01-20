import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Todo } from "../types";
import { taskKeys } from "./tasks";

export function useCreateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { content: string; taskId?: number }) =>
      api.post<Todo>("/todos", data),
    onSuccess: (_, variables) => {
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
      queryClient.invalidateQueries({ queryKey: taskKeys.details() });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; content?: string }) =>
      api.patch<Todo>(`/todos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.details() });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/todos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.details() });
    },
  });
}
