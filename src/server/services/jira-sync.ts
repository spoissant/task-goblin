import { eq, isNotNull } from "drizzle-orm";
import type { SearchAndReconcileResults } from "jira.js/out/version3/models";
import { convert as adfToMd } from "adf-to-md";
import { db } from "../../db";
import { tasks, settings } from "../../db/schema";
import { getJiraClient, getJiraConfig, JiraConfigError } from "../lib/jira-client";
import { now } from "../lib/timestamp";
import { isApiError } from "../lib/errors";
import type { SyncResult } from "../lib/types";

export type { SyncResult };

export class JiraApiError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

function stringifyDescription(description: unknown): string | null {
  if (!description) return null;
  if (typeof description === "string") return description;
  // ADF (Atlassian Document Format) - convert to markdown
  try {
    const _log = console.log;
    console.log = () => {};
    const { result } = adfToMd(description);
    console.log = _log;
    return result || null;
  } catch {
    // Fallback to JSON if conversion fails
    return JSON.stringify(description);
  }
}

function extractParent(issue: { fields: Record<string, unknown> }): { key: string; isEpic: boolean } | null {
  const parent = issue.fields.parent as { key?: string; fields?: { issuetype?: { name?: string } } } | undefined;
  if (!parent?.key) return null;
  const isEpic = parent.fields?.issuetype?.name?.toLowerCase() === "epic";
  return { key: parent.key, isEpic };
}

interface Sprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
}

interface IssueFields {
  summary?: string;
  description?: unknown;
  status?: { name?: string };
  issuetype?: { name?: string };
  assignee?: { displayName?: string };
  priority?: { name?: string };
  parent?: unknown;
  [key: string]: unknown;
}

function mapIssueToTaskData(issue: { key?: string; fields: IssueFields }, sprintFieldId: string | null) {
  const fields = issue.fields;
  const timestamp = now();

  // Extract active sprint name from custom field
  let sprintName: string | null = null;
  if (sprintFieldId) {
    const sprints = fields[sprintFieldId] as Sprint[] | null;
    const activeSprint = sprints?.find(s => s.state === "active");
    sprintName = activeSprint?.name ?? null;
  }

  const parent = extractParent({ fields: fields as Record<string, unknown> });

  return {
    jiraKey: issue.key!,
    title: fields.summary || issue.key!,
    description: stringifyDescription(fields.description),
    status: fields.status?.name || "todo",
    type: fields.issuetype?.name || null,
    assignee: fields.assignee?.displayName || null,
    priority: fields.priority?.name || null,
    sprint: sprintName,
    epicKey: parent?.isEpic ? parent.key : null,
    parentKey: parent && !parent.isEpic ? parent.key : null,
    jiraSyncedAt: timestamp,
    updatedAt: timestamp,
  };
}

// Watermark for the delta pass: start time of the last fully successful sync.
const JIRA_DELTA_SYNCED_AT = "jira_delta_synced_at";
// Start time of the last successful full reconcile sweep.
const JIRA_RECONCILED_AT = "jira_reconciled_at";
// How stale the delta watermark may get before we fall back to a full
// reconcile, and how often to reconcile regardless.
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Slack added to the delta window for clock skew and JQL minute granularity.
const DELTA_BUFFER_MINUTES = 5;

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

// Fields upsertTask writes from Jira. Used for change detection so an
// unchanged issue costs zero writes — most issues are unchanged on any
// given sync, and there are hundreds of them.
const SYNCED_FIELDS = [
  "title",
  "description",
  "status",
  "type",
  "assignee",
  "priority",
  "sprint",
  "epicKey",
  "parentKey",
] as const;

async function upsertTask(taskData: ReturnType<typeof mapIssueToTaskData>): Promise<"new" | "updated" | "unchanged"> {
  const existing = await db
    .select()
    .from(tasks)
    .where(eq(tasks.jiraKey, taskData.jiraKey));

  if (existing.length > 0) {
    const oldTask = existing[0];

    if (SYNCED_FIELDS.every((field) => oldTask[field] === taskData[field])) {
      return "unchanged";
    }

    // Update existing task, preserve PR fields if already merged
    await db
      .update(tasks)
      .set({
        title: taskData.title,
        description: taskData.description,
        status: taskData.status,
        type: taskData.type,
        assignee: taskData.assignee,
        priority: taskData.priority,
        sprint: taskData.sprint,
        epicKey: taskData.epicKey,
        parentKey: taskData.parentKey,
        jiraSyncedAt: taskData.jiraSyncedAt,
        updatedAt: taskData.updatedAt,
      })
      .where(eq(tasks.jiraKey, taskData.jiraKey));

    return "updated";
  } else {
    // Create new Jira-only task
    const timestamp = now();
    await db
      .insert(tasks)
      .values({
        ...taskData,
        createdAt: timestamp,
      });

    return "new";
  }
}

/** Page through a JQL search, returning every issue. */
async function searchAllIssues(
  client: ReturnType<typeof getJiraClient>,
  jql: string,
  fields: string[]
): Promise<Array<{ key?: string; fields: IssueFields }>> {
  const all: Array<{ key?: string; fields: IssueFields }> = [];
  let pageToken: string | undefined = undefined;

  while (true) {
    const response: SearchAndReconcileResults = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
      jql,
      maxResults: 100,
      nextPageToken: pageToken,
      fields,
    });

    const issues = (response.issues || []) as Array<{ key?: string; fields: IssueFields }>;
    all.push(...issues);

    if (issues.length === 0 || !response.nextPageToken) break;
    pageToken = response.nextPageToken;
  }

  return all;
}

export async function syncJiraItems(): Promise<SyncResult> {
  const config = await getJiraConfig();
  const client = getJiraClient(config);
  const startedAt = new Date();

  // Build JQL: use custom or default
  const jql =
    config.jql ||
    `assignee = "${config.email}" AND statusCategory != Done AND type != Epic ORDER BY updated DESC`;

  let synced = 0;
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const syncedKeys = new Set<string>();

  // Build fields array, optionally including sprint field
  const baseFields = ["summary", "description", "status", "issuetype", "assignee", "priority", "parent"];
  const fields = config.sprintField ? [...baseFields, config.sprintField] : baseFields;

  // Keys already tracked locally. The delta and reconcile passes only ever
  // *update* these — they must never insert. Both deliberately ignore the
  // active JQL's `statusCategory != Done` / `type != Epic` filters in order to
  // catch transitions into Done, so applying them as inserts would flood the
  // task list with completed issues and epics that were never tracked.
  const knownKeys = new Set(
    (await db.select({ jiraKey: tasks.jiraKey }).from(tasks).where(isNotNull(tasks.jiraKey)))
      .map((t) => t.jiraKey)
      .filter((key): key is string => !!key)
  );

  const applyIssues = async (
    issues: Array<{ key?: string; fields: IssueFields }>,
    { updatesOnly = false }: { updatesOnly?: boolean } = {}
  ) => {
    for (const issue of issues) {
      if (!issue.key) continue;
      if (updatesOnly && !knownKeys.has(issue.key)) continue;
      const taskData = mapIssueToTaskData(issue, config.sprintField);
      if (syncedKeys.has(taskData.jiraKey)) continue;
      syncedKeys.add(taskData.jiraKey);
      const result = await upsertTask(taskData);
      if (result === "new") newCount++;
      else if (result === "updated") updatedCount++;
      else unchangedCount++;
      synced++;
    }
  };

  try {
    // 1. Active work — the only pass allowed to create tasks.
    await applyIssues(await searchAllIssues(client, jql, fields));

    // 2. Delta pass: everything in scope that changed since the last successful
    //    sync, regardless of status. This is what catches issues transitioning
    //    to Done — they drop out of the active JQL, and previously the only way
    //    to notice was to re-fetch every key we'd ever seen. One request that
    //    does not grow with task count.
    //
    //    A relative window (`-Nm`) is used rather than an absolute timestamp
    //    because JQL parses absolute date strings in the Jira user's timezone,
    //    which we don't know here. Relative windows sidestep that entirely.
    const deltaSyncedAt = await getSetting(JIRA_DELTA_SYNCED_AT);
    const elapsedMs = deltaSyncedAt ? startedAt.getTime() - new Date(deltaSyncedAt).getTime() : null;
    const canUseDelta = elapsedMs !== null && elapsedMs >= 0 && elapsedMs <= RECONCILE_INTERVAL_MS;

    if (canUseDelta) {
      // Widen the window to absorb clock skew against Jira and JQL's
      // minute-level granularity. Costs nothing — still one request.
      const windowMinutes = Math.ceil(elapsedMs! / 60_000) + DELTA_BUFFER_MINUTES;
      await applyIssues(
        await searchAllIssues(client, `assignee = "${config.email}" AND updated >= -${windowMinutes}m`, fields),
        { updatesOnly: true }
      );
    }

    // 3. Reconcile pass: authoritative sweep of every tracked key, batched
    //    `key in (...)`. The delta pass is scoped by assignee, so it can miss
    //    an issue reassigned away from us or one outside a custom JQL's scope.
    //    This backstops those cases, and cold starts where there's no usable
    //    delta window. Amortized — not every sync.
    const reconciledAt = await getSetting(JIRA_RECONCILED_AT);
    const reconcileDue =
      !canUseDelta ||
      !reconciledAt ||
      startedAt.getTime() - new Date(reconciledAt).getTime() >= RECONCILE_INTERVAL_MS;

    if (reconcileDue) {
      // Guard against non-key values reaching JQL. Keys absent from the results
      // (deleted or inaccessible issues) are simply skipped.
      const staleKeys = [...knownKeys].filter(
        (key) => !syncedKeys.has(key) && /^[A-Z][A-Z0-9]*-\d+$/i.test(key)
      );

      let reconcileFailed = false;
      const KEYS_PER_QUERY = 100;
      for (let i = 0; i < staleKeys.length; i += KEYS_PER_QUERY) {
        const batch = staleKeys.slice(i, i + KEYS_PER_QUERY);
        try {
          await applyIssues(await searchAllIssues(client, `key in (${batch.join(",")})`, fields), {
            updatesOnly: true,
          });
        } catch {
          // Batch failed (e.g. a key in a project we lost access to). Skip it,
          // but don't record a successful reconcile.
          reconcileFailed = true;
        }
      }

      if (!reconcileFailed) {
        await setSetting(JIRA_RECONCILED_AT, startedAt.toISOString());
      }
    }

    // Only advance the delta watermark on a fully successful sync, so a
    // mid-sync failure re-examines that window next time instead of skipping it.
    await setSetting(JIRA_DELTA_SYNCED_AT, startedAt.toISOString());
  } catch (err: unknown) {
    if (err instanceof JiraConfigError) {
      throw err;
    }

    if (isApiError(err)) {
      if (err.status === 401 || err.status === 403) {
        throw new JiraApiError(
          "Jira authentication failed. Check your API token and email.",
          "JIRA_AUTH_FAILED"
        );
      }

      throw new JiraApiError(
        err.message || "Failed to fetch issues from Jira",
        "JIRA_API_ERROR"
      );
    }

    throw new JiraApiError("Failed to fetch issues from Jira", "JIRA_API_ERROR");
  }

  return { synced, new: newCount, updated: updatedCount, unchanged: unchangedCount };
}

export async function syncJiraItemByKey(key: string): Promise<{ status: "new" | "updated" | "unchanged" }> {
  const config = await getJiraConfig();
  const client = getJiraClient(config);

  // Build fields array, optionally including sprint field
  const baseFields = ["summary", "description", "status", "issuetype", "assignee", "priority", "parent"];
  const fields = config.sprintField ? [...baseFields, config.sprintField] : baseFields;

  try {
    const issue = await client.issues.getIssue({
      issueIdOrKey: key,
      fields,
    });

    const taskData = mapIssueToTaskData(issue as { key?: string; fields: IssueFields }, config.sprintField);
    const status = await upsertTask(taskData);
    return { status };
  } catch (err: unknown) {
    if (err instanceof JiraConfigError) {
      throw err;
    }

    if (isApiError(err)) {
      if (err.status === 401 || err.status === 403) {
        throw new JiraApiError(
          "Jira authentication failed. Check your API token and email.",
          "JIRA_AUTH_FAILED"
        );
      }
      if (err.status === 404) {
        throw new JiraApiError(
          `Issue ${key} not found in Jira`,
          "JIRA_ISSUE_NOT_FOUND"
        );
      }

      throw new JiraApiError(
        err.message || `Failed to fetch issue ${key} from Jira`,
        "JIRA_API_ERROR"
      );
    }

    throw new JiraApiError(`Failed to fetch issue ${key} from Jira`, "JIRA_API_ERROR");
  }
}
