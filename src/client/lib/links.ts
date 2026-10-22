import type { Repository } from "@/shared/types";

// Build Jira URL - requires jiraHost, returns null if not configured
export function getJiraUrl(jiraKey: string, jiraHost: string | undefined | null): string | null {
  if (!jiraHost) return null;
  const cleanHost = jiraHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanHost}/browse/${jiraKey}`;
}

// Build GitHub PR URL
export function getPrUrl(repo: Pick<Repository, "owner" | "repo"> | undefined | null, prNumber: number | null): string | null {
  if (!repo || !prNumber) return null;
  return `https://github.com/${repo.owner}/${repo.repo}/pull/${prNumber}`;
}
