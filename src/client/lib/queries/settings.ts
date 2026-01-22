import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Settings,
  JiraConfig,
  StatusSettings,
  StatusCategory,
  TaskFilter,
  ListResponse,
  // Legacy types
  StatusConfigResponse,
  StatusConfig,
} from "../types";

export const settingsKeys = {
  all: ["settings"] as const,
  jiraConfig: () => [...settingsKeys.all, "jira-config"] as const,
  // New keys
  statusSettings: () => [...settingsKeys.all, "status-settings"] as const,
  statusCategories: () => [...settingsKeys.all, "status-categories"] as const,
  taskFilters: () => [...settingsKeys.all, "task-filters"] as const,
  // Legacy keys
  statusConfig: () => [...settingsKeys.all, "status-config"] as const,
  selectableStatuses: () => [...settingsKeys.all, "selectable-statuses"] as const,
};

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useJiraConfigQuery() {
  return useQuery({
    queryKey: settingsKeys.jiraConfig(),
    queryFn: () => api.get<JiraConfig>("/settings/jira/config"),
  });
}

export function useUpdateJiraConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: Partial<JiraConfig>) =>
      api.put<JiraConfig>("/settings/jira/config", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.jiraConfig() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | null }) =>
      api.put(`/settings/${key}`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

// ============================================
// NEW Status Settings Queries
// ============================================

// Combined status settings (categories + filters + defaultColor)
export function useStatusSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.statusSettings(),
    queryFn: () => api.get<StatusSettings>("/settings/status-settings"),
  });
}

// Status Categories
export function useStatusCategoriesQuery() {
  return useQuery({
    queryKey: settingsKeys.statusCategories(),
    queryFn: () => api.get<ListResponse<StatusCategory>>("/settings/status-categories"),
  });
}

export function useUpdateStatusCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categories: Omit<StatusCategory, "id">[]) =>
      api.put<ListResponse<StatusCategory>>("/settings/status-categories", { categories }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusCategories() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusSettings() });
      // Also invalidate legacy queries
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusConfig() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.selectableStatuses() });
    },
  });
}

// Task Filters
export function useTaskFiltersQuery() {
  return useQuery({
    queryKey: settingsKeys.taskFilters(),
    queryFn: () => api.get<ListResponse<TaskFilter>>("/settings/task-filters"),
  });
}

export function useUpdateTaskFilters() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filters: Omit<TaskFilter, "id">[]) =>
      api.put<ListResponse<TaskFilter>>("/settings/task-filters", { filters }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.taskFilters() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusSettings() });
    },
  });
}

// Default Color
export function useUpdateDefaultColor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (defaultColor: string) =>
      api.put<{ defaultColor: string }>("/settings/status-default-color", { defaultColor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusSettings() });
      // Also invalidate legacy queries
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusConfig() });
    },
  });
}

// ============================================
// Legacy Status Configuration Queries (for backwards compatibility)
// ============================================

export function useStatusConfigQuery() {
  return useQuery({
    queryKey: settingsKeys.statusConfig(),
    queryFn: () => api.get<StatusConfigResponse>("/settings/statuses"),
  });
}

export function useSelectableStatusesQuery() {
  return useQuery({
    queryKey: settingsKeys.selectableStatuses(),
    queryFn: () => api.get<ListResponse<StatusConfig>>("/settings/statuses/selectable"),
  });
}

export function useUpdateStatusConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { statuses: StatusConfig[]; defaultColor?: string }) =>
      api.put<StatusConfigResponse>("/settings/statuses", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusConfig() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.selectableStatuses() });
      // Also invalidate new queries
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusCategories() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusSettings() });
    },
  });
}
