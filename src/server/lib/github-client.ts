import { Octokit } from "@octokit/rest";
import { AppError, httpStatusOf } from "./errors";
import { getSetting } from "./settings";
import { GITHUB_USERNAME_SETTING } from "@/shared/settings-keys";

interface GitHubConfig {
  username: string;
}

/** GitHub failed or refused a call, or isn't configured; carries the status the API answers with. */
export class GitHubError extends AppError {
  constructor(message: string, statusCode: number, code: string) {
    super(message, statusCode, code);
    this.name = "GitHubError";
  }
}

/**
 * A failed GitHub call as the API answers it: 401 when the token is refused,
 * 404 when what was asked for isn't there, 502 for anything else. An AppError,
 * already classified (GitHub not configured, say), passes through.
 */
export function toGitHubError(err: unknown, failed: string, notFound?: string): AppError {
  if (err instanceof AppError) return err;
  const status = httpStatusOf(err);
  if (status === 401) {
    return new GitHubError("GitHub authentication failed. Check your GITHUB_TOKEN.", 401, "GITHUB_AUTH_FAILED");
  }
  const message = err instanceof Error && err.message ? err.message : failed;
  if (status === 404) return new GitHubError(notFound ?? message, 404, "GITHUB_NOT_FOUND");
  return new GitHubError(message, 502, "GITHUB_API_ERROR");
}

const notConfigured = (message: string) => new GitHubError(message, 400, "GITHUB_NOT_CONFIGURED");

export async function getGitHubConfig(): Promise<GitHubConfig> {
  const username = await getSetting(GITHUB_USERNAME_SETTING);
  if (!username) throw notConfigured("GitHub username not configured. Set github_username in settings.");
  if (!process.env.GITHUB_TOKEN) throw notConfigured("GITHUB_TOKEN environment variable not set.");
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
 * POST; queries are retried, mutations (merges, reviews) are not.
 */
function isRetryableRead(options: { method?: string; url?: string; query?: unknown }): boolean {
  if (options.method === "GET") return true;
  if (!/\/graphql$/.test(options.url ?? "")) return false;
  return !/^\s*mutation\b/.test(String(options.query ?? ""));
}

export function getGitHubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw notConfigured("GITHUB_TOKEN environment variable not set.");

  const octokit = new Octokit({ auth: token });

  octokit.hook.wrap("request", async (request, options) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(options);
      } catch (err) {
        const status = httpStatusOf(err);
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
