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

// Slack emoji the standup uses as statuses, custom ones included, shown as Unicode on the page.
const EMOJI: Record<string, string> = {
  white_check_mark: "✅",
  qa: "🧪",
  nerd_face: "🤓",
  progress_bar: "⏳",
  rotating_light: "🚨",
  // Older standups still use these.
  merged: "🟣",
  eyes: "👀",
};

/** Show the standup's Slack emoji shortcodes as Unicode; unknown ones stay as typed. */
export function renderSlackEmoji(markdown: string): string {
  return markdown.replace(/:([a-z0-9_+-]+):/g, (code, name: string) => EMOJI[name] ?? code);
}
