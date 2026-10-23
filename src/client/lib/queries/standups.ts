import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ListResponse, Standup } from "@/shared/types";

const standupKeys = {
  all: ["standups"] as const,
};

/** Recent standups, newest first. Refreshed over SSE when a run starts or ends. */
export function useStandupsQuery() {
  return useQuery({
    queryKey: standupKeys.all,
    queryFn: () => api.get<ListResponse<Standup>>("/standups"),
  });
}

/** Starts `claude -p /standup` on the server; resolves with the row in `running`. */
export function useGenerateStandup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<Standup>("/standups"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: standupKeys.all });
    },
  });
}

/** Drafts a finished standup in today's Slack async-update thread; resolves with the Slack link. */
export function useDraftStandupToSlack() {
  return useMutation({
    mutationFn: (id: number) => api.post<{ link: string }>(`/standups/${id}/slack-draft`),
  });
}
