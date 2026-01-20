import { eq } from "drizzle-orm";
import type { SearchAndReconcileResults } from "jira.js/out/version3/models";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { getJiraClient, getJiraConfig, JiraConfigError } from "../lib/jira-client";
import { now } from "../lib/timestamp";

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
  // ADF (Atlassian Document Format) - stringify as JSON
  return JSON.stringify(description);
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

interface IssueFields {
  summary?: string;
  description?: unknown;
  status?: { name?: string };
  issuetype?: { name?: string };
  assignee?: { displayName?: string };
  priority?: { name?: string };
  parent?: unknown;
}

function mapIssueToTaskData(issue: { key?: string; fields: IssueFields }) {
  const fields = issue.fields;
  const timestamp = now();
  return {
    jiraKey: issue.key!,
    title: fields.summary || issue.key!,
    description: stringifyDescription(fields.description),
    status: fields.status?.name || "todo",
    type: fields.issuetype?.name || null,
    assignee: fields.assignee?.displayName || null,
    priority: fields.priority?.name || null,
    sprint: null, // Custom field, skip for v1
    epicKey: extractEpicKey({ fields: fields as Record<string, unknown> }),
    lastComment: null, // Requires separate API call, skip for v1
    jiraSyncedAt: timestamp,
    updatedAt: timestamp,
  };
}

async function upsertTask(taskData: ReturnType<typeof mapIssueToTaskData>): Promise<"new" | "updated"> {
  const existing = await db
    .select({ id: tasks.id, prNumber: tasks.prNumber })
    .from(tasks)
    .where(eq(tasks.jiraKey, taskData.jiraKey));

  if (existing.length > 0) {
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
        lastComment: taskData.lastComment,
        jiraSyncedAt: taskData.jiraSyncedAt,
        updatedAt: taskData.updatedAt,
      })
      .where(eq(tasks.jiraKey, taskData.jiraKey));
    return "updated";
  } else {
    // Create new Jira-only task
    const timestamp = now();
    await db.insert(tasks).values({
      ...taskData,
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

  const maxResults = 50;
  let pageToken: string | undefined = undefined;

  try {
    while (true) {
      const response: SearchAndReconcileResults = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        maxResults,
        nextPageToken: pageToken,
        fields: [
          "summary",
          "description",
          "status",
          "issuetype",
          "assignee",
          "priority",
          "parent",
        ],
      });

      const issues = response.issues || [];
      if (issues.length === 0) {
        break;
      }

      for (const issue of issues) {
        const taskData = mapIssueToTaskData(issue as { key?: string; fields: IssueFields });
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
  } catch (err: unknown) {
    if (err instanceof JiraConfigError) {
      throw err;
    }

    const error = err as { status?: number; message?: string };
    if (error.status === 401 || error.status === 403) {
      throw new JiraApiError(
        "Jira authentication failed. Check your API token and email.",
        "JIRA_AUTH_FAILED"
      );
    }

    throw new JiraApiError(
      error.message || "Failed to fetch issues from Jira",
      "JIRA_API_ERROR"
    );
  }

  return { synced, new: newCount, updated: updatedCount };
}

export async function syncJiraItemByKey(key: string): Promise<{ status: "new" | "updated" }> {
  const config = await getJiraConfig();
  const client = getJiraClient(config);

  try {
    const issue = await client.issues.getIssue({
      issueIdOrKey: key,
      fields: [
        "summary",
        "description",
        "status",
        "issuetype",
        "assignee",
        "priority",
        "parent",
      ],
    });

    const taskData = mapIssueToTaskData(issue as { key?: string; fields: IssueFields });
    const status = await upsertTask(taskData);
    return { status };
  } catch (err: unknown) {
    if (err instanceof JiraConfigError) {
      throw err;
    }

    const error = err as { status?: number; message?: string };
    if (error.status === 401 || error.status === 403) {
      throw new JiraApiError(
        "Jira authentication failed. Check your API token and email.",
        "JIRA_AUTH_FAILED"
      );
    }
    if (error.status === 404) {
      throw new JiraApiError(
        `Issue ${key} not found in Jira`,
        "JIRA_ISSUE_NOT_FOUND"
      );
    }

    throw new JiraApiError(
      error.message || `Failed to fetch issue ${key} from Jira`,
      "JIRA_API_ERROR"
    );
  }
}
