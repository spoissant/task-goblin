import type { ReviewRequest } from "../../shared/types";

/** A JSON array of GitHub logins from settings, lowercased. Anything malformed reads as empty. */
export function parseUsernames(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Bots author PRs and the assignee owns them, so an ignored author's PR is
 * only ignored while nobody is assigned to it.
 */
export function isIgnoredRequest(request: ReviewRequest, ignored: Set<string>): boolean {
  return ignored.has(request.author.toLowerCase()) && request.assignees.length === 0;
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
