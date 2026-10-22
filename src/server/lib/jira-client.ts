import { Version3Client } from "jira.js";
import { AppError, httpStatusOf } from "./errors";
import { getSetting } from "./settings";

export interface JiraConfig {
  host: string;
  email: string;
  jql: string | null;
  sprintField: string | null;
}

/** Jira failed or refused a call, or isn't configured; carries the status the API answers with. */
export class JiraError extends AppError {
  constructor(message: string, statusCode: number, code: string) {
    super(message, statusCode, code);
    this.name = "JiraError";
  }
}

/**
 * A failed Jira call as the API answers it: 401 when the credentials are
 * refused (Jira says 401 or 403), 404 when the issue isn't there, 502 for
 * anything else. An AppError, already classified, passes through.
 */
export function toJiraError(err: unknown, failed: string, notFound?: string): AppError {
  if (err instanceof AppError) return err;
  const status = httpStatusOf(err);
  if (status === 401 || status === 403) {
    return new JiraError("Jira authentication failed. Check your API token and email.", 401, "JIRA_AUTH_FAILED");
  }
  const message = err instanceof Error && err.message ? err.message : failed;
  if (status === 404) return new JiraError(notFound ?? message, 404, "JIRA_NOT_FOUND");
  return new JiraError(message, 502, "JIRA_API_ERROR");
}

const notConfigured = (message: string) => new JiraError(message, 400, "JIRA_NOT_CONFIGURED");

export async function getJiraConfig(): Promise<JiraConfig> {
  const [host, email, jql, sprintField] = await Promise.all(
    ["jira_host", "jira_email", "jira_jql", "jira_sprint_field"].map(getSetting)
  );
  if (!host) throw notConfigured("Jira host not configured. Set jira_host in settings.");
  if (!email) throw notConfigured("Jira email not configured. Set jira_email in settings.");
  if (!process.env.JIRA_API_TOKEN) throw notConfigured("JIRA_API_TOKEN environment variable not set.");
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
