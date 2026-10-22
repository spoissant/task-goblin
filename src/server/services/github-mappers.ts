import { now } from "../lib/timestamp";
import type { tasks } from "../../db/schema";
import type { ChecksResult, GqlPrCore } from "./github-graphql";

type TaskRow = typeof tasks.$inferSelect;

/**
 * The task columns a PR sets. Every write of a PR onto a task (the sync, a
 * manual link, a task merge) copies exactly this list, so none leaves one stale.
 */
export const PR_FIELDS = [
  "prNumber",
  "repositoryId",
  "prState",
  "headBranch",
  "baseBranch",
  "headSha",
  "mergeCommitSha",
  "isDraft",
  "checksStatus",
  "checksDetails",
  "reviewStatus",
  "unresolvedCommentCount",
  "hasConflicts",
  "changedFiles",
  "additions",
  "deletions",
  "changesByCategory",
  "prSyncedAt",
  "onDeploymentBranches",
  "labelOnlyDeploymentBranches",
  "deployedOnBranches",
] as const satisfies readonly (keyof TaskRow)[];

type PrFields = Pick<TaskRow, (typeof PR_FIELDS)[number]>;

/** The PR columns of a task row, or of a fetched PR. */
export function prFieldsOf(source: PrFields): PrFields {
  return Object.fromEntries(PR_FIELDS.map((field) => [field, source[field]])) as PrFields;
}

/** A PR as fetched from GitHub: its title and every PR column. */
export interface PrTaskData extends PrFields {
  title: string;
  prNumber: number;
  repositoryId: number;
  prState: string;
  headBranch: string;
  isDraft: number;
  reviewStatus: string; // JSON ReviewStatus
  unresolvedCommentCount: number;
  hasConflicts: number;
  prSyncedAt: string;
}

const branchList = (branches: string[]) => (branches.length > 0 ? JSON.stringify(branches) : null);

export function mapGqlPrToTaskData(
  pr: GqlPrCore,
  repositoryId: number,
  checksResult: ChecksResult,
  onDeploymentBranches: string[],
  deployedOnBranches: string[],
  labelOnlyDeploymentBranches: string[]
): PrTaskData {
  return {
    prNumber: pr.number,
    repositoryId,
    title: pr.title,
    // GraphQL reports MERGED directly, where REST needed state + merged flag.
    prState: pr.state.toLowerCase(),
    headBranch: pr.headRefName || "",
    baseBranch: pr.baseRefName || null,
    headSha: pr.headRefOid,
    mergeCommitSha: pr.mergeCommitOid,
    isDraft: pr.isDraft ? 1 : 0,
    checksStatus: checksResult.checksStatus,
    checksDetails: checksResult.checksDetails,
    reviewStatus: JSON.stringify(pr.reviewStatus),
    unresolvedCommentCount: pr.unresolvedCommentCount,
    // UNKNOWN means GitHub is still computing the merge; treated as no conflict,
    // matching REST's null mergeable.
    hasConflicts: pr.mergeable === "CONFLICTING" ? 1 : 0,
    changedFiles: pr.changedFiles,
    additions: pr.additions,
    deletions: pr.deletions,
    changesByCategory: pr.changesByCategory ? JSON.stringify(pr.changesByCategory) : null,
    prSyncedAt: now(),
    onDeploymentBranches: branchList(onDeploymentBranches),
    labelOnlyDeploymentBranches: branchList(labelOnlyDeploymentBranches),
    deployedOnBranches: branchList(deployedOnBranches),
  };
}

// Map PR state to a PR-only task's status (a status category name)
export function mapPrStateToTaskStatus(prState: string, isDraft: number): string {
  if (prState === "merged") return "Done";
  if (prState === "closed") return "Done";
  if (isDraft) return "In Progress";
  return "Code Review"; // Open PR = code review
}
