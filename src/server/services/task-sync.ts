/**
 * Re-pull one task from its sources: its Jira issue, its GitHub PR (linking the
 * PR opened from its branch when it has none yet), and its worktree's git status.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { repositories, tasks, taskWorktrees } from "../../db/schema";
import { AppError } from "../lib/errors";
import { getTaskOrThrow, getTaskWithRepository } from "../lib/queries";
import { now } from "../lib/timestamp";
import { fetchPrTaskData, findPrNumberByBranch, syncGitHubPullRequestByNumber } from "./github-sync";
import { syncJiraItemByKey } from "./jira-sync";
import { refreshTaskGitStatus } from "./task-worktrees";

/**
 * Link a GitHub PR to an existing task: fetch it, reject it when another task
 * already has it, and copy its fields onto the task.
 */
export async function linkPrToTask(id: number, owner: string, repo: string, prNumber: number) {
  const data = await fetchPrTaskData(owner, repo, prNumber);

  // Reject if another task already has this PR
  const conflict = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.repositoryId, data.repositoryId),
        eq(tasks.prNumber, data.prNumber),
        ne(tasks.id, id)
      )
    )
    .limit(1);

  if (conflict.length > 0) {
    throw new AppError(
      `PR #${prNumber} is already linked to task #${conflict[0].id}: ${conflict[0].title}`,
      409,
      "PR_ALREADY_LINKED"
    );
  }

  const result = await db
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
      reviewStatus: data.reviewStatus,
      unresolvedCommentCount: data.unresolvedCommentCount,
      hasConflicts: data.hasConflicts,
      onDeploymentBranches: data.onDeploymentBranches,
      labelOnlyDeploymentBranches: data.labelOnlyDeploymentBranches,
      deployedOnBranches: data.deployedOnBranches,
      changedFiles: data.changedFiles,
      additions: data.additions,
      deletions: data.deletions,
      prSyncedAt: data.prSyncedAt,
      updatedAt: now(),
    })
    .where(eq(tasks.id, id))
    .returning();

  return result[0];
}

/**
 * Link the PR opened from the task's branch (its headBranch, else its worktree's
 * branch). A no-op that returns the task when it already has a PR, has no
 * branch or repository, or no PR exists for the branch yet.
 */
export async function linkPrByBranch(id: number) {
  const task = await getTaskOrThrow(id);
  if (task.prNumber) return task;

  const [worktree] = await db.select().from(taskWorktrees).where(eq(taskWorktrees.taskId, id));
  const branch = task.headBranch ?? worktree?.branch ?? null;
  const repositoryId = task.repositoryId ?? worktree?.repositoryId ?? null;
  if (!branch || !repositoryId) return task;

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, repositoryId));
  if (!repo) return task;

  const prNumber = await findPrNumberByBranch(repo.owner, repo.repo, branch);
  if (!prNumber) return task;

  return linkPrToTask(id, repo.owner, repo.repo, prNumber);
}

/** Same steps as the MCP sync_task tool; each source fails on its own. Returns the errors. */
export async function syncTask(taskId: number): Promise<string[]> {
  const task = await getTaskWithRepository(taskId);
  if (!task) return [];
  const errors: string[] = [];
  const attempt = async (source: string, step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (err) {
      errors.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (task.jiraKey) await attempt("Jira", () => syncJiraItemByKey(task.jiraKey!));
  if (!task.prNumber) {
    await attempt("GitHub", () => linkPrByBranch(taskId));
  } else if (task.repository) {
    const { owner, repo } = task.repository;
    await attempt("GitHub", () => syncGitHubPullRequestByNumber(owner, repo, task.prNumber!));
  }
  await attempt("Git status", () => refreshTaskGitStatus(taskId));
  return errors;
}
