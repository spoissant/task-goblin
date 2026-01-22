import { eq, and, isNotNull, notInArray } from "drizzle-orm";
import type { SearchAndReconcileResults } from "jira.js/out/version3/models";
import { convert as adfToMd } from "adf-to-md";
import { db } from "../../db";
import { tasks, logs } from "../../db/schema";
import { getJiraClient, getJiraConfig, JiraConfigError } from "../lib/jira-client";
import { now } from "../lib/timestamp";
import { generateTaskDiff, formatDiffLog } from "../lib/diff";
import { isApiError } from "../lib/errors";

const JIRA_TRACKED_FIELDS = [
  "title",
  "description",
  "status",
  "type",
  "assignee",
  "priority",
  "sprint",
  "epicKey",
] as const;

const LARGE_FIELDS = ["description"] as const;

function formatJiraCreatedLog(status: string, jiraKey: string, title: string): string {
  return `# Task created\n${status} - ${jiraKey} - ${title}`;
}

export interface SyncResult {
  synced: number;
  new: number;
  updated: number;
}

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
    const { result } = adfToMd(description);
    return result || null;
  } catch {
    // Fallback to JSON if conversion fails
    return JSON.stringify(description);
  }
}

function extractEpicKey(issue: { fields: Record<string, unknown> }): string | null {
  const parent = issue.fields.parent as { key?: string; fields?: { issuetype?: { name?: string } } } | undefined;
  if (!parent?.key) return null;
  // Only return if parent is an Epic
  const parentType = parent.fields?.issuetype?.name?.toLowerCase();
  if (parentType === "epic") {
    return parent.key;
  }
  return null;
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

  return {
    jiraKey: issue.key!,
    title: fields.summary || issue.key!,
    description: stringifyDescription(fields.description),
    status: fields.status?.name || "todo",
    type: fields.issuetype?.name || null,
    assignee: fields.assignee?.displayName || null,
    priority: fields.priority?.name || null,
    sprint: sprintName,
    epicKey: extractEpicKey({ fields: fields as Record<string, unknown> }),
    jiraSyncedAt: timestamp,
    updatedAt: timestamp,
  };
}

async function upsertTask(taskData: ReturnType<typeof mapIssueToTaskData>): Promise<"new" | "updated"> {
  const existing = await db
    .select()
    .from(tasks)
    .where(eq(tasks.jiraKey, taskData.jiraKey));

  if (existing.length > 0) {
    const oldTask = existing[0];

    // Compare fields and generate diff
    const diffs = generateTaskDiff(
      oldTask as unknown as Record<string, unknown>,
      taskData as unknown as Record<string, unknown>,
      JIRA_TRACKED_FIELDS
    );

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
        jiraSyncedAt: taskData.jiraSyncedAt,
        updatedAt: taskData.updatedAt,
      })
      .where(eq(tasks.jiraKey, taskData.jiraKey));

    // Only log if there were actual changes
    if (diffs.length > 0) {
      const timestamp = now();
      await db.insert(logs).values({
        taskId: oldTask.id,
        content: formatDiffLog(diffs, LARGE_FIELDS),
        source: "jira",
        createdAt: timestamp,
      });
    }

    return "updated";
  } else {
    // Create new Jira-only task
    const timestamp = now();
    const result = await db
      .insert(tasks)
      .values({
        ...taskData,
        createdAt: timestamp,
      })
      .returning({ id: tasks.id });

    // Log new task creation
    await db.insert(logs).values({
      taskId: result[0].id,
      content: formatJiraCreatedLog(taskData.status, taskData.jiraKey, taskData.title),
      source: "jira",
      createdAt: timestamp,
    });

    return "new";
  }
}

export async function syncJiraItems(): Promise<SyncResult> {
  const config = await getJiraConfig();
  const client = getJiraClient(config);

  // Build JQL: use custom or default
  const jql =
    config.jql ||
    `assignee = "${config.email}" AND statusCategory != Done AND type != Epic ORDER BY updated DESC`;

  let synced = 0;
  let newCount = 0;
  let updatedCount = 0;
  const syncedKeys = new Set<string>();

  const maxResults = 50;
  let pageToken: string | undefined = undefined;

  // Build fields array, optionally including sprint field
  const baseFields = ["summary", "description", "status", "issuetype", "assignee", "priority", "parent"];
  const fields = config.sprintField ? [...baseFields, config.sprintField] : baseFields;

  try {
    while (true) {
      const response: SearchAndReconcileResults = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        maxResults,
        nextPageToken: pageToken,
        fields,
      });

      const issues = response.issues || [];
      if (issues.length === 0) {
        break;
      }

      for (const issue of issues) {
        const taskData = mapIssueToTaskData(issue as { key?: string; fields: IssueFields }, config.sprintField);
        syncedKeys.add(taskData.jiraKey);
        const result = await upsertTask(taskData);
        if (result === "new") newCount++;
        else updatedCount++;
        synced++;
      }

      if (!response.nextPageToken) {
        break;
      }
      pageToken = response.nextPageToken;
    }

    // Sync orphaned tasks (Jira issues that transitioned to Done)
    const orphanedTasks = syncedKeys.size > 0
      ? await db
          .select({ jiraKey: tasks.jiraKey })
          .from(tasks)
          .where(
            and(
              isNotNull(tasks.jiraKey),
              notInArray(tasks.jiraKey, [...syncedKeys])
            )
          )
      : await db
          .select({ jiraKey: tasks.jiraKey })
          .from(tasks)
          .where(isNotNull(tasks.jiraKey));

    for (const task of orphanedTasks) {
      if (!task.jiraKey) continue;
      try {
        const issue = await client.issues.getIssue({
          issueIdOrKey: task.jiraKey,
          fields,
        });
        const taskData = mapIssueToTaskData(issue as { key?: string; fields: IssueFields }, config.sprintField);
        const result = await upsertTask(taskData);
        if (result === "new") newCount++;
        else updatedCount++;
        synced++;
      } catch {
        // Issue may be deleted or inaccessible, skip
      }
    }
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

  // Log sync completion
  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} new`);
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  const summary = parts.length > 0 ? parts.join(", ") : "no changes";

  await db.insert(logs).values({
    taskId: null,
    content: `Jira sync completed: ${summary}`,
    source: "jira",
    createdAt: now(),
  });

  return { synced, new: newCount, updated: updatedCount };
}

export async function syncJiraItemByKey(key: string): Promise<{ status: "new" | "updated" }> {
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
