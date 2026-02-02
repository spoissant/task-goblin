import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Note, NoteWithTasks, PaginatedResponse } from "../types";

export const noteKeys = {
  all: ["notes"] as const,
  lists: () => [...noteKeys.all, "list"] as const,
  list: (filters: { q?: string; limit?: number; offset?: number }) =>
    [...noteKeys.lists(), filters] as const,
  details: () => [...noteKeys.all, "detail"] as const,
  detail: (id: number) => [...noteKeys.details(), id] as const,
  forTask: (taskId: number) => [...noteKeys.all, "forTask", taskId] as const,
};

export function useNotesQuery(
  filters: { q?: string; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const query = params.toString();

  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: () =>
      api.get<PaginatedResponse<Note>>(`/notes${query ? `?${query}` : ""}`),
  });
}

export function useNoteDetailQuery(id: number) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: () => api.get<NoteWithTasks>(`/notes/${id}`),
    enabled: id > 0,
  });
}

export function useNotesForTaskQuery(taskId: number) {
  return useQuery({
    queryKey: noteKeys.forTask(taskId),
    queryFn: () => api.get<{ items: Note[]; total: number }>(`/tasks/${taskId}/notes`),
    enabled: taskId > 0,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title: string; content?: string; taskIds?: number[] }) =>
      api.post<Note>("/notes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; content?: string }) =>
      api.patch<Note>(`/notes/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(variables.id) });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
    },
  });
}

export function useLinkNoteTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, taskIds }: { noteId: number; taskIds: number[] }) =>
      api.put<NoteWithTasks>(`/notes/${noteId}/tasks`, { taskIds }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(variables.noteId) });
    },
  });
}
