import { now } from "../lib/timestamp";

export interface ChecksResult {
  checksStatus: string | null;
  checksDetails: string | null;
}

export interface PrTaskData {
  prNumber: number;
  repositoryId: number;
  title: string;
  prState: string;
  prAuthor: string | null;
  headBranch: string;
  baseBranch: string | null;
  isDraft: number;
  checksStatus: string | null;
  checksDetails: string | null;
  reviewStatus: string | null;
  approvedReviewCount: number;
  unresolvedCommentCount: number;
  prSyncedAt: string;
  updatedAt: string;
  onDeploymentBranches: string | null;
}

export function formatPrCreatedLog(isDraft: number, prState: string, prNumber: number, headBranch: string): string {
  const draftStatus = isDraft ? "Draft" : "Ready";
  return `# Task created\n${draftStatus} - ${prState} - #${prNumber} - ${headBranch}`;
}

export function mapPrToTaskData(
  pr: {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    merged?: boolean;
    user?: { login?: string } | null;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
  },
  repositoryId: number,
  approvedReviewCount = 0,
  checksResult: ChecksResult = { checksStatus: null, checksDetails: null },
  onDeploymentBranches: string[] = [],
  unresolvedCommentCount = 0
): PrTaskData {
  // Map state: GitHub has open/closed + merged boolean, we use open/closed/merged
  const prState = pr.merged ? "merged" : pr.state;
  const timestamp = now();

  return {
    prNumber: pr.number,
    repositoryId,
    title: pr.title,
    prState,
    prAuthor: pr.user?.login || null,
    headBranch: pr.head?.ref || "",
    baseBranch: pr.base?.ref || null,
    isDraft: pr.draft ? 1 : 0,
    checksStatus: checksResult.checksStatus,
    checksDetails: checksResult.checksDetails,
    reviewStatus: null, // Requires separate API call, skip for v1
    approvedReviewCount,
    unresolvedCommentCount,
    prSyncedAt: timestamp,
    updatedAt: timestamp,
    onDeploymentBranches: onDeploymentBranches.length > 0 ? JSON.stringify(onDeploymentBranches) : null,
  };
}

// Map PR state to task status
export function mapPrStateToTaskStatus(prState: string, isDraft: number): string {
  if (prState === "merged") return "done";
  if (prState === "closed") return "done";
  if (isDraft) return "in_progress";
  return "code_review"; // Open PR = code review
}
