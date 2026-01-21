import { Version3Client } from "jira.js";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";

export interface JiraConfig {
  host: string;
  email: string;
  jql: string | null;
  sprintField: string | null;
}

export class JiraConfigError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "JiraConfigError";
  }
}

async function getSetting(key: string): Promise<string | null> {
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key));
  return result[0]?.value ?? null;
}

export async function getJiraConfig(): Promise<JiraConfig> {
  const host = await getSetting("jira_host");
  const email = await getSetting("jira_email");
  const jql = await getSetting("jira_jql");
  const sprintField = await getSetting("jira_sprint_field");

  if (!host) {
    throw new JiraConfigError(
      "Jira host not configured. Set jira_host in settings.",
      "JIRA_NOT_CONFIGURED"
    );
  }

  if (!email) {
    throw new JiraConfigError(
      "Jira email not configured. Set jira_email in settings.",
      "JIRA_NOT_CONFIGURED"
    );
  }

  const apiToken = process.env.JIRA_API_TOKEN;
  if (!apiToken) {
    throw new JiraConfigError(
      "JIRA_API_TOKEN environment variable not set.",
      "JIRA_NOT_CONFIGURED"
    );
  }

  return { host, email, jql, sprintField };
}

export function getJiraClient(config: JiraConfig): Version3Client {
  const apiToken = process.env.JIRA_API_TOKEN!;

  return new Version3Client({
    host: config.host,
    authentication: {
      basic: {
        email: config.email,
        apiToken,
      },
    },
  });
}
