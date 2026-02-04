import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ReviewRequest, ListResponse } from "../types";

export const reviewKeys = {
  all: ["reviews"] as const,
  requests: () => [...reviewKeys.all, "requests"] as const,
};

export function useReviewRequestsQuery() {
  return useQuery({
    queryKey: reviewKeys.requests(),
    queryFn: () => api.get<ListResponse<ReviewRequest>>("/github/review-requests"),
  });
}
