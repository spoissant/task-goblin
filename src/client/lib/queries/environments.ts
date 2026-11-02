import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { EnvironmentStatus, ListResponse } from "@/shared/types";

export const ENVIRONMENTS_REFRESH_MS = 2 * 60_000;

/** Staging and barney deploy + gate status; read live from Buildkite, so polled unless autoRefresh is off. */
export function useEnvironmentsQuery(autoRefresh: boolean) {
  return useQuery({
    queryKey: ["environments"],
    queryFn: () => api.get<ListResponse<EnvironmentStatus>>("/environments"),
    refetchInterval: autoRefresh ? ENVIRONMENTS_REFRESH_MS : false,
  });
}
