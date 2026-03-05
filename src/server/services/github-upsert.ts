import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { tasks, logs } from "../../db/schema";
import { now } from "../lib/timestamp";
import { logDiffsIfChanged } from "../lib/diff";
import { formatPrCreatedLog, mapPrStateToTaskStatus } from "./github-mappers";
import type { PrTaskData } from "./github-mappers";

const GITHUB_TRACKED_FIELDS = [
  "prState",
  "prAuthor",
  "headBranch",
  "baseBranch",
  "isDraft",
  "checksStatus",
  "approvedReviewCount",
  "unresolvedCommentCount",
  "hasConflicts",
] as const;

const LARGE_FIELDS = ["checksDetails"] as const;

/**
 * Extract Jira keys from PR title in format [KEY-123]
 */
function extractJiraKeysFromTitle(title: string): string[] {
  const regex = /\[([A-Z][A-Z0-9]*-\d+)\]/g;
  const keys: string[] = [];
  let match;
  while ((match = regex.exec(title)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

/**
 * Update a task's PR fields by Jira key (keeps existing title)
 */
async function updateTaskByJiraKey(
  jiraKey: string,
  data: PrTaskData
): Promise<"updated" | "unchanged" | "not_found"> {
  const existing = await db
    .select()
    .from(tasks)
    .where(eq(tasks.jiraKey, jiraKey));

  if (existing.length === 0) {
    return "not_found";
  }

  const oldTask = existing[0];

  // Update PR fields only, preserve title and other Jira data
  await db
    .update(tasks)
    .set({
      prNumber: data.prNumber,
      repositoryId: data.repositoryId,
      prState: data.prState,
      prAuthor: data.prAuthor,
      headBranch: data.headBranch,
      baseBranch: data.baseBranch,
      isDraft: data.isDraft,
      checksStatus: data.checksStatus,
      checksDetails: data.checksDetails,
      approvedReviewCount: data.approvedReviewCount,
      unresolvedCommentCount: data.unresolvedCommentCount,
      hasConflicts: data.hasConflicts,
      onDeploymentBranches: data.onDeploymentBranches,
      changedFiles: data.changedFiles,
      additions: data.additions,
      deletions: data.deletions,
      prSyncedAt: data.prSyncedAt,
      updatedAt: data.updatedAt,
    })
    .where(eq(tasks.id, oldTask.id));

  const changed = await logDiffsIfChanged(
    oldTask as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
    { taskId: oldTask.id, trackedFields: GITHUB_TRACKED_FIELDS, largeFields: LARGE_FIELDS, source: "github" },
  );
  return changed ? "updated" : "unchanged";
}

/**
 * Upsert by pr_number or headBranch (original matching logic)
 */
async function upsertPrTaskByNumber(data: PrTaskData): Promise<"new" | "updated" | "unchanged"> {
  // First, try to find by repositoryId + prNumber (if we already synced this PR)
  const existingByNumber = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.prNumber, data.prNumber)
      )
    );

  if (existingByNumber.length > 0) {
    const oldTask = existingByNumber[0];

    // Update existing, preserve Jira fields if already merged
    await db
      .update(tasks)
      .set({
        title: oldTask.jiraKey ? undefined : data.title, // Keep Jira title if merged
        prState: data.prState,
        prAuthor: data.prAuthor,
        headBranch: data.headBranch,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        checksDetails: data.checksDetails,
        approvedReviewCount: data.approvedReviewCount,
        unresolvedCommentCount: data.unresolvedCommentCount,
        hasConflicts: data.hasConflicts,
        onDeploymentBranches: data.onDeploymentBranches,
        changedFiles: data.changedFiles,
        additions: data.additions,
        deletions: data.deletions,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, oldTask.id));

    const changed = await logDiffsIfChanged(
      oldTask as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      { taskId: oldTask.id, trackedFields: GITHUB_TRACKED_FIELDS, largeFields: LARGE_FIELDS, source: "github" },
    );
    return changed ? "updated" : "unchanged";
  }

  // Next, try to find by repositoryId + headBranch (local entry waiting for sync)
  const existingByBranch = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.headBranch, data.headBranch)
      )
    );

  if (existingByBranch.length > 0) {
    const oldTask = existingByBranch[0];

    // Update existing local entry with GitHub data, preserve Jira fields
    await db
      .update(tasks)
      .set({
        prNumber: data.prNumber,
        title: oldTask.jiraKey ? undefined : data.title, // Keep Jira title if merged
        prState: data.prState,
        prAuthor: data.prAuthor,
        baseBranch: data.baseBranch,
        isDraft: data.isDraft,
        checksStatus: data.checksStatus,
        checksDetails: data.checksDetails,
        approvedReviewCount: data.approvedReviewCount,
        unresolvedCommentCount: data.unresolvedCommentCount,
        hasConflicts: data.hasConflicts,
        onDeploymentBranches: data.onDeploymentBranches,
        changedFiles: data.changedFiles,
        additions: data.additions,
        deletions: data.deletions,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, oldTask.id));

    const changed = await logDiffsIfChanged(
      oldTask as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      { taskId: oldTask.id, trackedFields: GITHUB_TRACKED_FIELDS, largeFields: LARGE_FIELDS, source: "github" },
    );
    return changed ? "updated" : "unchanged";
  }

  // Check if PR title contains Jira keys matching existing tasks
  // If so, skip creation - updateTaskByJiraKey will handle it
  const jiraKeys = extractJiraKeysFromTitle(data.title);
  if (jiraKeys.length > 0) {
    const existingJiraTask = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.jiraKey, jiraKeys))
      .limit(1);

    if (existingJiraTask.length > 0) {
      return "unchanged";
    }
  }

  // No existing entry, create new PR-only task (orphaned)
  const timestamp = now();
  const result = await db
    .insert(tasks)
    .values({
      title: data.title,
      description: null,
      status: mapPrStateToTaskStatus(data.prState, data.isDraft),
      prNumber: data.prNumber,
      repositoryId: data.repositoryId,
      headBranch: data.headBranch,
      baseBranch: data.baseBranch,
      prState: data.prState,
      prAuthor: data.prAuthor,
      isDraft: data.isDraft,
      checksStatus: data.checksStatus,
      checksDetails: data.checksDetails,
      approvedReviewCount: data.approvedReviewCount,
      unresolvedCommentCount: data.unresolvedCommentCount,
      hasConflicts: data.hasConflicts,
      onDeploymentBranches: data.onDeploymentBranches,
      changedFiles: data.changedFiles,
      additions: data.additions,
      deletions: data.deletions,
      prSyncedAt: data.prSyncedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning({ id: tasks.id });

  // Log new task creation
  await db.insert(logs).values({
    taskId: result[0].id,
    content: formatPrCreatedLog(data.isDraft, data.prState, data.prNumber, data.headBranch),
    source: "github",
    createdAt: timestamp,
  });

  return "new";
}

/**
 * Main upsert function: handles pr_number/branch matching + Jira key matching
 */
export async function upsertPrTask(data: PrTaskData): Promise<"new" | "updated" | "unchanged"> {
  // 1. Standard upsert by pr_number or branch
  const primaryResult = await upsertPrTaskByNumber(data);

  // 2. Extract Jira keys from title and update matching tasks
  const jiraKeys = extractJiraKeysFromTitle(data.title);
  let jiraUpdated = false;

  for (const key of jiraKeys) {
    const result = await updateTaskByJiraKey(key, data);
    if (result === "updated") {
      jiraUpdated = true;
    }
  }

  // Return most significant result
  if (primaryResult === "new") return "new";
  if (primaryResult === "updated" || jiraUpdated) return "updated";
  return "unchanged";
}
