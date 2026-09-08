import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export interface StandupReport {
  from: string;
  to: string;
  available: string[];
  markdown: string;
  changedCount: number;
  takenAt: string;
  assignee: string | null;
}

export interface StandupResponse {
  report: StandupReport | null;
  available: string[];
  reason: string | null;
}

export interface SnapshotResult {
  date: string;
  path: string;
  written: boolean;
  taskCount: number;
  assignee: string | null;
}

export const standupKeys = {
  all: ["standup"] as const,
  report: (from?: string | null, to?: string | null) =>
    [...standupKeys.all, "report", from ?? null, to ?? null] as const,
};

export interface StandupRange {
  from?: string | null;
  to?: string | null;
}

export function useStandupQuery({ from, to }: StandupRange = {}) {
  return useQuery({
    queryKey: standupKeys.report(from, to),
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.size ? `?${params}` : "";
      return api.get<StandupResponse>(`/standup${query}`);
    },
    // The diff is recomputed from files on every call, so it's cheap — but it
    // only changes when a new snapshot lands, not on every window refocus.
    staleTime: 60_000,
  });
}

/** Overwrites today's snapshot, so the report reflects the board as of now.
 *  `synced` records whether the caller refreshed Jira/GitHub first. */
export function useTakeSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ synced }: { synced: boolean } = { synced: false }) =>
      api.post<SnapshotResult>("/standup/snapshots", { force: true, synced }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: standupKeys.all });
    },
  });
}
