import type { ReviewRequest } from "../../shared/types";
import { parseStringList } from "../../shared/json";
import { isReviewReady } from "../../shared/review-status";

/** A JSON array of GitHub logins from settings, lowercased. Anything malformed reads as empty. */
export function parseUsernames(value: string | null | undefined): Set<string> {
  return new Set(parseStringList(value).map((v) => v.toLowerCase()));
}

/**
 * Bots author PRs and the assignee owns them, so an ignored author's PR is
 * only ignored while nobody is assigned to it.
 */
export function isIgnoredRequest(request: ReviewRequest, ignored: Set<string>): boolean {
  return ignored.has(request.author.toLowerCase()) && request.assignees.length === 0;
}

/**
 * Another review from you can't move the PR: GitHub says its reviews are done,
 * or it has its approvals and only owes code-owner reviews from others.
 * Unknown (null) never counts, so the PR stays listed.
 */
export function isReviewSatisfied(request: ReviewRequest): boolean {
  const status = request.reviewStatus;
  if (!status) return false;
  return (
    isReviewReady(status) ||
    (status.approvedCount >= status.requiredApprovals && request.myMissingCodeOwners.length === 0)
  );
}

/**
 * Over 75% of the changed lines are backend. Unknown (null) or empty never
 * counts, so the PR stays listed.
 */
export function isMostlyBackend(request: ReviewRequest): boolean {
  const changes = request.changesByCategory;
  if (!changes) return false;
  const lines = (c: { additions: number; deletions: number }) => c.additions + c.deletions;
  const total = lines(changes.frontend) + lines(changes.backend) + lines(changes.other);
  return total > 0 && lines(changes.backend) / total > 0.75;
}

/** owner/repo#number: the PR's row key and its entry in the high-priority setting. */
export function prKey(request: ReviewRequest): string {
  return `${request.repo.owner}/${request.repo.repo}#${request.prNumber}`;
}

export type MemberTag = "vip" | "team";

export function memberTag(login: string, teamMembers: Set<string>, vips: Set<string>): MemberTag | null {
  const lower = login.toLowerCase();
  if (vips.has(lower)) return "vip";
  if (teamMembers.has(lower)) return "team";
  return null;
}

/** The row's highlight, from its author or any assignee. A VIP outranks a teammate. */
export function requestTag(request: ReviewRequest, teamMembers: Set<string>, vips: Set<string>): MemberTag | null {
  const tags = [request.author, ...request.assignees].map((login) => memberTag(login, teamMembers, vips));
  if (tags.includes("vip")) return "vip";
  if (tags.includes("team")) return "team";
  return null;
}
