import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { tasks, logs } from "../../db/schema";
import { now } from "../lib/timestamp";
import { generateTaskDiff, formatDiffLog } from "../lib/diff";
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
] as const;

const LARGE_FIELDS = ["checksDetails"] as const;

export async function upsertPrTask(data: PrTaskData): Promise<"new" | "updated"> {
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

    // Compare fields and generate diff
    const diffs = generateTaskDiff(
      oldTask as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      GITHUB_TRACKED_FIELDS
    );

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
        reviewStatus: data.reviewStatus,
        approvedReviewCount: data.approvedReviewCount,
        unresolvedCommentCount: data.unresolvedCommentCount,
        onDeploymentBranches: data.onDeploymentBranches,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, oldTask.id));

    // Only log if there were actual changes
    if (diffs.length > 0) {
      const timestamp = now();
      await db.insert(logs).values({
        taskId: oldTask.id,
        content: formatDiffLog(diffs, LARGE_FIELDS),
        source: "github",
        createdAt: timestamp,
      });
    }

    return "updated";
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

    // Compare fields and generate diff
    const diffs = generateTaskDiff(
      oldTask as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      GITHUB_TRACKED_FIELDS
    );

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
        reviewStatus: data.reviewStatus,
        approvedReviewCount: data.approvedReviewCount,
        unresolvedCommentCount: data.unresolvedCommentCount,
        onDeploymentBranches: data.onDeploymentBranches,
        prSyncedAt: data.prSyncedAt,
        updatedAt: data.updatedAt,
      })
      .where(eq(tasks.id, oldTask.id));

    // Only log if there were actual changes
    if (diffs.length > 0) {
      const timestamp = now();
      await db.insert(logs).values({
        taskId: oldTask.id,
        content: formatDiffLog(diffs, LARGE_FIELDS),
        source: "github",
        createdAt: timestamp,
      });
    }

    return "updated";
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
      reviewStatus: data.reviewStatus,
      approvedReviewCount: data.approvedReviewCount,
      unresolvedCommentCount: data.unresolvedCommentCount,
      onDeploymentBranches: data.onDeploymentBranches,
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
