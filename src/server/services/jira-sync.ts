import { sql } from "drizzle-orm";
import { db } from "../../db";
import { jiraItems } from "../../db/schema";
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

function mapIssueToItemData(issue: { key?: string; fields: IssueFields }) {
  const fields = issue.fields;
  return {
    key: issue.key!,
    summary: fields.summary || "",
    description: stringifyDescription(fields.description),
    status: fields.status?.name || "Unknown",
    type: fields.issuetype?.name || null,
    assignee: fields.assignee?.displayName || null,
    priority: fields.priority?.name || null,
    sprint: null, // Custom field, skip for v1
    epicKey: extractEpicKey({ fields: fields as Record<string, unknown> }),
    lastComment: null, // Requires separate API call, skip for v1
    updatedAt: now(),
  };
}

async function upsertJiraItem(itemData: ReturnType<typeof mapIssueToItemData>): Promise<"new" | "updated"> {
  const existing = await db
    .select({ id: jiraItems.id })
    .from(jiraItems)
    .where(sql`${jiraItems.key} = ${itemData.key}`);

  if (existing.length > 0) {
    await db
      .update(jiraItems)
      .set({
        summary: itemData.summary,
        description: itemData.description,
        status: itemData.status,
        type: itemData.type,
        assignee: itemData.assignee,
        priority: itemData.priority,
        sprint: itemData.sprint,
        epicKey: itemData.epicKey,
        lastComment: itemData.lastComment,
        updatedAt: itemData.updatedAt,
      })
      .where(sql`${jiraItems.key} = ${itemData.key}`);
    return "updated";
  } else {
    await db.insert(jiraItems).values(itemData);
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
  let startAt = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await client.issueSearch.searchForIssuesUsingJql({
        jql,
        startAt,
        maxResults,
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
        hasMore = false;
        break;
      }

      for (const issue of issues) {
        const itemData = mapIssueToItemData(issue as { key?: string; fields: IssueFields });
        const result = await upsertJiraItem(itemData);
        if (result === "new") newCount++;
        else updatedCount++;
        synced++;
      }

      // Check if there are more results
      const total = response.total || 0;
      startAt += issues.length;
      hasMore = startAt < total;
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

    const itemData = mapIssueToItemData(issue as { key?: string; fields: IssueFields });
    const status = await upsertJiraItem(itemData);
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
