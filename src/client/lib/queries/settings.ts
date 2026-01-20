import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Settings, JiraConfig } from "../types";

export const settingsKeys = {
  all: ["settings"] as const,
  jiraConfig: () => [...settingsKeys.all, "jira-config"] as const,
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
