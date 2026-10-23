/**
 * Where a synced PR lands, decided here only. The tasks already holding it (by
 * number) keep it. The Jira tasks it names take it too: each one its title tags
 * as [KEY-123] (a PR may close several tickets), else the ticket its branch is
 * named after. Otherwise it becomes a PR-only task. A PR-only task holding a PR
 * that turns out to name a Jira task (one created after it) merges into it.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { now } from "../lib/timestamp";
import { getNotCompletedCondition } from "../lib/task-status";
import { mapPrStateToTaskStatus, prFieldsOf, type PrTaskData } from "./github-mappers";
import { mergeSingleTask } from "./task-merge";

type TaskRow = typeof tasks.$inferSelect;
type PrOnlyFields = Partial<Pick<TaskRow, "title" | "status">>;

/** Jira keys tagged in a PR title as [KEY-123]. */
function titleKeys(title: string): string[] {
  return [...title.matchAll(/\[([A-Z][A-Z0-9]*-\d+)\]/g)].map((m) => m[1]);
}

/** Jira keys in a branch name: fix/ev-123-polls → EV-123. */
function branchKeys(branch: string): string[] {
  return [...branch.toUpperCase().matchAll(/[A-Z][A-Z0-9]*-\d+/g)].map((m) => m[0]);
}

/**
 * A Jira task already set to another repository is not this PR's: a hivetests
 * PR's branch carries its alumni_connect parent's key too.
 */
const inRepository = (repositoryId: number) => or(isNull(tasks.repositoryId), eq(tasks.repositoryId, repositoryId));

/**
 * The Jira tasks the PR names: those its title tags, else — when no Jira task
 * holds it yet — the open ticket without a PR its branch is named after.
 */
async function namedJiraTasks(data: PrTaskData, holders: TaskRow[]): Promise<TaskRow[]> {
  const tagged = titleKeys(data.title);
  if (tagged.length > 0) {
    const rows = await db.select().from(tasks).where(and(inArray(tasks.jiraKey, tagged), inRepository(data.repositoryId)));
    if (rows.length > 0) return rows;
  }
  const keys = branchKeys(data.headBranch);
  if (keys.length === 0 || holders.some((t) => t.jiraKey)) return [];
  return db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.jiraKey, keys),
        isNull(tasks.prNumber),
        inRepository(data.repositoryId),
        await getNotCompletedCondition()
      )
    )
    .limit(1);
}

/** Write a PR's columns onto a task, plus the title and status a task without a Jira issue takes from it. */
export async function writePrFields(taskId: number, data: PrTaskData, extra: PrOnlyFields = {}): Promise<void> {
  await db.update(tasks).set({ ...prFieldsOf(data), ...extra, updatedAt: now() }).where(eq(tasks.id, taskId));
}

/**
 * A task without a Jira issue shows its PR's title, and moves to Done once the
 * PR merges or closes; a status set by hand stays while the PR is open.
 */
function prOnlyFields(task: TaskRow, data: PrTaskData): PrOnlyFields {
  const finished = data.prState !== "open" && task.prState !== data.prState;
  return finished ? { title: data.title, status: mapPrStateToTaskStatus(data.prState, data.isDraft) } : { title: data.title };
}

async function insertPrTask(data: PrTaskData): Promise<void> {
  const timestamp = now();
  await db.insert(tasks).values({
    ...prFieldsOf(data),
    title: data.title,
    status: mapPrStateToTaskStatus(data.prState, data.isDraft),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

/** Upsert a synced PR; "new" when it became a PR-only task. */
export async function upsertPrTask(data: PrTaskData): Promise<"new" | "updated"> {
  const holders = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.repositoryId, data.repositoryId), eq(tasks.prNumber, data.prNumber)));
  const named = await namedJiraTasks(data, holders);
  if (named.length === 0 && holders.length === 0) {
    await insertPrTask(data);
    return "new";
  }

  let targets = holders;
  if (named.length > 0) {
    for (const orphan of holders.filter((t) => !t.jiraKey)) await mergeSingleTask(named[0].id, orphan.id);
    const ids = new Set(named.map((t) => t.id));
    targets = [...named, ...holders.filter((t) => t.jiraKey && !ids.has(t.id))];
  }
  for (const task of targets) await writePrFields(task.id, data, task.jiraKey ? {} : prOnlyFields(task, data));
  return "updated";
}
