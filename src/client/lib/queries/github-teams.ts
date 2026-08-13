import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { GitHubTeam, ListResponse } from "../types";

const githubTeamKeys = {
  all: ["github-teams"] as const,
  lists: () => [...githubTeamKeys.all, "list"] as const,
};

/** Teams the configured GitHub token belongs to. */
export function useGitHubTeamsQuery() {
  return useQuery({
    queryKey: githubTeamKeys.lists(),
    queryFn: () => api.get<ListResponse<GitHubTeam>>("/github/teams"),
  });
}
