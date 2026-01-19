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

export function getGitHubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubConfigError(
      "GITHUB_TOKEN environment variable not set.",
      "GITHUB_NOT_CONFIGURED"
    );
  }

  return new Octokit({ auth: token });
}
