import { getJiraUrl } from "@/client/lib/links";

const MARKDOWN_LINK = /(\[[^\]]*\]\([^)]*\))/;
const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** Link bare Jira keys to the configured host, leaving existing markdown links alone. */
export function linkJiraKeys(markdown: string, jiraHost: string | null | undefined): string {
  if (!jiraHost) return markdown;
  return markdown
    .split(MARKDOWN_LINK)
    .map((part, i) => (i % 2 ? part : part.replace(JIRA_KEY, (key) => `[${key}](${getJiraUrl(key, jiraHost)})`)))
    .join("");
}
