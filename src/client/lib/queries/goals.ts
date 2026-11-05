import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Goal, GoalListItem, ListResponse, Task } from "@/shared/types";
import { taskKeys } from "./tasks";

export const goalKeys = {
  all: ["goals"] as const,
  list: (archived: boolean) => [...goalKeys.all, "list", archived] as const,
};

/** Goals in section order, with progress. Active by default; archived=true lists the hidden ones. */
export function useGoalsQuery(archived = false) {
  return useQuery({
    queryKey: goalKeys.list(archived),
    queryFn: () => api.get<ListResponse<GoalListItem>>(`/goals${archived ? "?archived=true" : ""}`),
  });
}

function useInvalidateGoals() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: goalKeys.all });
}

export function useCreateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (data: { name: string; context?: string | null; epicKeys?: string[] }) => api.post<Goal>("/goals", data),
    onSuccess: invalidate,
  });
}

export function useUpdateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; context?: string | null; archived?: boolean; epicKeys?: string[] }) =>
      api.patch<Goal>(`/goals/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useReorderGoals() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>("/goals/order", { ids }),
    onSuccess: invalidate,
  });
}

/** Deleting a goal unassigns its tasks, so the task lists refresh too. */
export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/** Move tasks to a goal (null = Unassigned), one PATCH per task. */
export function useAssignTasksToGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskIds, goalId }: { taskIds: number[]; goalId: number | null }) =>
      Promise.all(taskIds.map((id) => api.patch<Task>(`/tasks/${id}`, { goalId }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
    },
  });
}
