import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ListResponse } from "../types";
import type { InboxItem } from "@/shared/inbox";

export const inboxKeys = {
  all: ["inbox"] as const,
};

/** Everything waiting on the user; refreshed by SSE `task` and `session` events. */
export function useInboxQuery() {
  return useQuery({
    queryKey: inboxKeys.all,
    queryFn: () => api.get<ListResponse<InboxItem>>("/inbox"),
  });
}
