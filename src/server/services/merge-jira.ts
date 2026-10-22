// Moves a merged PR's Jira ticket from Ready to Merge to Ready to Prod, so it
// doesn't wait on Jira's own post-merge rule, which often never fires. Runs
// after every sync, whoever merged the PR; merging itself stays manual.
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { getJiraClient, getJiraConfig } from "../lib/jira-client";
import { broadcast } from "../lib/sse";
import { now } from "../lib/timestamp";
import { normalize, readyToMergeStatuses } from "./merge-gate";

const READY_TO_PROD = "ready to prod";

export interface IssueTransitions {
  status: string;
  /** The transitions open from that status, with their target status names. */
  transitions: { id: string; to: string }[];
}

/** The Jira calls this step makes, behind a port so tests stub them. */
export interface MergeJira {
  issueTransitions(key: string): Promise<IssueTransitions>;
  transition(key: string, transitionId: string): Promise<void>;
}

function createDefault(): MergeJira {
  const client = async () => getJiraClient(await getJiraConfig());
  return {
    async issueTransitions(key) {
      const issue = await (await client()).issues.getIssue({ issueIdOrKey: key, fields: ["status"], expand: "transitions" });
      return {
        status: issue.fields.status?.name ?? "",
        transitions: (issue.transitions ?? []).map((t) => ({ id: t.id ?? "", to: t.to?.name ?? "" })),
      };
    },
    async transition(key, transitionId) {
      await (await client()).issues.doTransition({ issueIdOrKey: key, transition: { id: transitionId } });
    },
  };
}

let instance: MergeJira | null = null;

export function getMergeJira(): MergeJira {
  if (!instance) instance = createDefault();
  return instance;
}

/** Test seam. */
export function setMergeJira(stub: MergeJira): void {
  instance = stub;
}

export function resetMergeJira(): void {
  instance = null;
}

interface MergedTicket {
  id: number;
  jiraKey: string;
}

/** Re-read the ticket's live status first: Jira's rule or a person may have moved it since the last sync. */
async function moveTicket(task: MergedTicket, ready: Set<string>, jira: MergeJira): Promise<void> {
  const { status, transitions } = await jira.issueTransitions(task.jiraKey);
  let next = status;
  if (ready.has(normalize(status))) {
    const toProd = transitions.find((t) => normalize(t.to) === READY_TO_PROD);
    if (!toProd) {
      console.error(`[merge-jira] ${task.jiraKey}: no transition to Ready to Prod from ${status}`);
      return;
    }
    await jira.transition(task.jiraKey, toProd.id);
    next = toProd.to;
  }
  await db.update(tasks).set({ status: next, updatedAt: now() }).where(eq(tasks.id, task.id));
  broadcast("task", { taskId: task.id });
}

/** Move the ticket of each merged PR still in Ready to Merge to Ready to Prod. */
export async function runMergeJira(): Promise<void> {
  const ready = await readyToMergeStatuses();
  const merged = await db
    .select({ id: tasks.id, jiraKey: tasks.jiraKey, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.prState, "merged"), isNotNull(tasks.jiraKey)));
  const jira = getMergeJira();
  for (const { id, jiraKey, status } of merged) {
    if (!jiraKey || !ready.has(normalize(status))) continue;
    try {
      await moveTicket({ id, jiraKey }, ready, jira);
    } catch (err) {
      console.error(`[merge-jira] ${jiraKey} failed`, err instanceof Error ? err.message : err);
    }
  }
}
