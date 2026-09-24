import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ClaudeSession, ListResponse, RecentClaudeSession, SessionEffort, SessionModel } from "../types";
import { taskKeys } from "./tasks";

export const sessionKeys = {
  all: ["sessions"] as const,
  latest: () => [...sessionKeys.all, "latest"] as const,
  recent: () => [...sessionKeys.all, "recent"] as const,
  reviews: () => [...sessionKeys.all, "reviews"] as const,
  task: (taskId: number) => [...sessionKeys.all, "task", taskId] as const,
};

/** Newest session per task, for the tasks table. */
export function useLatestSessionsQuery() {
  return useQuery({
    queryKey: sessionKeys.latest(),
    queryFn: () => api.get<ListResponse<ClaudeSession>>("/sessions"),
  });
}

/** Newest sessions across all tasks, for the sessions page. */
export function useRecentSessionsQuery() {
  return useQuery({
    queryKey: sessionKeys.recent(),
    queryFn: () => api.get<ListResponse<RecentClaudeSession>>("/sessions/recent?limit=50"),
  });
}

/** Newest task-less review session per PR, for the Reviews page. */
export function useReviewSessionsQuery() {
  return useQuery({
    queryKey: sessionKeys.reviews(),
    queryFn: () => api.get<ListResponse<ClaudeSession>>("/review-sessions"),
  });
}

/** A colleague's PR by URL, or one of your own PRs through its task's code-review chore. */
export type StartReviewInput = { prUrl: string } | { taskId: number };

export function useStartReviewSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartReviewInput) =>
      "prUrl" in input
        ? api.post<ClaudeSession>("/review-sessions", { prUrl: input.prUrl })
        : api.post<ClaudeSession>(`/tasks/${input.taskId}/sessions`, { choreKey: "code-review-pr" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useTaskSessionsQuery(taskId: number) {
  return useQuery({
    queryKey: sessionKeys.task(taskId),
    queryFn: () => api.get<ListResponse<ClaudeSession>>(`/tasks/${taskId}/sessions`),
    enabled: taskId > 0,
  });
}

export interface StartSessionInput {
  taskId: number;
  prompt: string;
  model: SessionModel;
  effort: SessionEffort;
  /** Records the session under that chore; the prompt stands in for its command. */
  choreKey?: string;
}

export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...body }: StartSessionInput) =>
      api.post<ClaudeSession>(`/tasks/${taskId}/sessions`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useStopSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<ClaudeSession>(`/sessions/${id}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useRespawnSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<ClaudeSession>(`/sessions/${id}/respawn`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}
