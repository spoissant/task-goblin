import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ReviewRequest, ListResponse } from "../types";

export type ReviewScope = "others" | "mine";

export const reviewKeys = {
  all: ["reviews"] as const,
  requests: (scope: ReviewScope) => [...reviewKeys.all, "requests", scope] as const,
};

export function useReviewRequestsQuery(scope: ReviewScope) {
  return useQuery({
    queryKey: reviewKeys.requests(scope),
    queryFn: () => api.get<ListResponse<ReviewRequest>>(`/github/review-requests?scope=${scope}`),
  });
}
