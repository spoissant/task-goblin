import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Settings, JiraConfig, StatusConfigResponse, FetchStatusesResponse, StatusConfig, ListResponse } from "../types";

export const settingsKeys = {
  all: ["settings"] as const,
  jiraConfig: () => [...settingsKeys.all, "jira-config"] as const,
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

// Status configuration queries
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
    },
  });
}

export function useFetchJiraStatuses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<FetchStatusesResponse>("/settings/statuses/fetch", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.statusConfig() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.selectableStatuses() });
    },
  });
}
