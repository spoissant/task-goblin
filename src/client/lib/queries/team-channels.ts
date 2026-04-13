import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { TeamChannel, ListResponse } from "../types";

const teamChannelKeys = {
  all: ["team-channels"] as const,
  lists: () => [...teamChannelKeys.all, "list"] as const,
};

export function useTeamChannelsQuery() {
  return useQuery({
    queryKey: teamChannelKeys.lists(),
    queryFn: () => api.get<ListResponse<TeamChannel>>("/team-channels"),
  });
}

export function useCreateTeamChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { githubTeamSlug: string; slackChannel: string }) =>
      api.post<TeamChannel>("/team-channels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamChannelKeys.lists() });
    },
  });
}

export function useUpdateTeamChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; githubTeamSlug?: string; slackChannel?: string }) =>
      api.patch<TeamChannel>(`/team-channels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamChannelKeys.lists() });
    },
  });
}

export function useDeleteTeamChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/team-channels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamChannelKeys.lists() });
    },
  });
}
