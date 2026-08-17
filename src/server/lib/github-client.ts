import { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";

export interface GitHubConfig {
  username: string;
}

export class GitHubConfigError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "GitHubConfigError";
  }
}

async function getSetting(key: string): Promise<string | null> {
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key));
  return result[0]?.value ?? null;
}

export async function getGitHubConfig(): Promise<GitHubConfig> {
  const username = await getSetting("github_username");

  if (!username) {
    throw new GitHubConfigError(
      "GitHub username not configured. Set github_username in settings.",
      "GITHUB_NOT_CONFIGURED"
    );
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubConfigError(
      "GITHUB_TOKEN environment variable not set.",
      "GITHUB_NOT_CONFIGURED"
    );
  }

  return { username };
}

// GitHub API degradations surface as transient 404s on PR subresources — a
// /pulls/N/reviews call 404s while /pulls/N still answers 200 — on top of the
// usual 5xx and gateway timeouts. Two short retries ride out the blip instead
// of failing whichever request happened to land in it.
const RETRYABLE_STATUSES = new Set([404, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [300, 1200];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads only — retrying a write could double-apply it. GraphQL goes out as a
 * POST, but every query this app sends is read-only.
 */
function isRetryableRead(options: { method?: string; url?: string }): boolean {
  return options.method === "GET" || /\/graphql$/.test(options.url ?? "");
}

export function getGitHubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubConfigError(
      "GITHUB_TOKEN environment variable not set.",
      "GITHUB_NOT_CONFIGURED"
    );
  }

  const octokit = new Octokit({ auth: token });

  octokit.hook.wrap("request", async (request, options) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(options);
      } catch (err) {
        const status = (err as { status?: number }).status;
        // A network-level failure arrives without a status — also transient.
        const transient = status === undefined || RETRYABLE_STATUSES.has(status);
        if (!transient || !isRetryableRead(options) || attempt >= RETRY_DELAYS_MS.length) {
          throw err;
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  });

  return octokit;
}
