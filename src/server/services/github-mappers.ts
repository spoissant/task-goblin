import { now } from "../lib/timestamp";
import type { ReviewStatus } from "@/shared/review-status";
import type { ChangesByCategory } from "@/shared/types";

export interface ChecksResult {
  checksStatus: string | null;
  checksDetails: string | null;
}

export interface PrTaskData {
  prNumber: number;
  repositoryId: number;
  title: string;
  prState: string;
  headBranch: string;
  baseBranch: string | null;
  headSha: string | null;
  mergeCommitSha: string | null;
  isDraft: number;
  checksStatus: string | null;
  checksDetails: string | null;
  reviewStatus: string; // JSON ReviewStatus
  unresolvedCommentCount: number;
  hasConflicts: number;
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
  changesByCategory: string | null; // JSON ChangesByCategory
  prSyncedAt: string;
  updatedAt: string;
  onDeploymentBranches: string | null;
  labelOnlyDeploymentBranches: string | null;
  deployedOnBranches: string | null;
}

export interface GqlPrLike {
  number: number;
  title: string;
  /** GraphQL PullRequestState: OPEN | CLOSED | MERGED */
  state: string;
  isDraft: boolean;
  /** GraphQL MergeableState: MERGEABLE | CONFLICTING | UNKNOWN */
  mergeable: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  changesByCategory: ChangesByCategory | null;
  headRefName: string | null;
  headRefOid?: string | null;
  mergeCommitOid?: string | null;
  baseRefName: string | null;
  unresolvedCommentCount: number;
  reviewStatus: ReviewStatus;
}

export function mapGqlPrToTaskData(
  pr: GqlPrLike,
  repositoryId: number,
  checksResult: ChecksResult,
  onDeploymentBranches: string[] = [],
  deployedOnBranches: string[] = [],
  labelOnlyDeploymentBranches: string[] = []
): PrTaskData {
  const timestamp = now();

  return {
    prNumber: pr.number,
    repositoryId,
    title: pr.title,
    // GraphQL reports MERGED directly, where REST needed state + merged flag.
    prState: pr.state.toLowerCase(),
    headBranch: pr.headRefName || "",
    baseBranch: pr.baseRefName || null,
    headSha: pr.headRefOid ?? null,
    mergeCommitSha: pr.mergeCommitOid ?? null,
    isDraft: pr.isDraft ? 1 : 0,
    checksStatus: checksResult.checksStatus,
    checksDetails: checksResult.checksDetails,
    reviewStatus: JSON.stringify(pr.reviewStatus),
    unresolvedCommentCount: pr.unresolvedCommentCount,
    // UNKNOWN means GitHub is still computing the merge; treated as no conflict,
    // matching REST's null mergeable.
    hasConflicts: pr.mergeable === "CONFLICTING" ? 1 : 0,
    changedFiles: pr.changedFiles ?? null,
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changesByCategory: pr.changesByCategory ? JSON.stringify(pr.changesByCategory) : null,
    prSyncedAt: timestamp,
    updatedAt: timestamp,
    onDeploymentBranches: onDeploymentBranches.length > 0 ? JSON.stringify(onDeploymentBranches) : null,
    labelOnlyDeploymentBranches: labelOnlyDeploymentBranches.length > 0 ? JSON.stringify(labelOnlyDeploymentBranches) : null,
    deployedOnBranches: deployedOnBranches.length > 0 ? JSON.stringify(deployedOnBranches) : null,
  };
}

// Map PR state to a PR-only task's status (a status category name)
export function mapPrStateToTaskStatus(prState: string, isDraft: number): string {
  if (prState === "merged") return "Done";
  if (prState === "closed") return "Done";
  if (isDraft) return "In Progress";
  return "Code Review"; // Open PR = code review
}
