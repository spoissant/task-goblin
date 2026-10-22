import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Settings,
  JiraConfig,
  StatusSettings,
  StatusCategory,
  ListResponse,
} from "../types";

const settingsKeys = {
  all: ["settings"] as const,
  jiraConfig: () => [...settingsKeys.all, "jira-config"] as const,
  statusSettings: () => [...settingsKeys.all, "status-settings"] as const,
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

// Status categories and the color of unmapped statuses
export function useStatusSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.statusSettings(),
    queryFn: () => api.get<StatusSettings>("/settings/status-settings"),
  });
}

// Status Categories
export function useUpdateStatusCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categories: Omit<StatusCategory, "id">[]) =>
      api.put<ListResponse<StatusCategory>>("/settings/status-categories", { categories }),
    onSuccess: () => {
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
