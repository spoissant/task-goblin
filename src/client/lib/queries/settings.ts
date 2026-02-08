import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Settings,
  JiraConfig,
  StatusSettings,
  StatusCategory,
  TaskFilter,
  ListResponse,
  StatusConfig,
} from "../types";

export const settingsKeys = {
  all: ["settings"] as const,
  jiraConfig: () => [...settingsKeys.all, "jira-config"] as const,
  statusSettings: () => [...settingsKeys.all, "status-settings"] as const,
  statusCategories: () => [...settingsKeys.all, "status-categories"] as const,
  taskFilters: () => [...settingsKeys.all, "task-filters"] as const,
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
    },
  });
}

// Selectable statuses for dropdowns
export function useSelectableStatusesQuery() {
  return useQuery({
    queryKey: settingsKeys.selectableStatuses(),
    queryFn: () => api.get<ListResponse<StatusConfig>>("/settings/statuses/selectable"),
  });
}
