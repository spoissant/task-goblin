import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { handleResponse } from "@/shared/api";
import type { Task, Repository, ListResponse } from "@/shared/types";

const BASE_URL = process.env.API_URL || "http://localhost:3456";

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  return handleResponse<T>(res);
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
  });
  return handleResponse<T>(res);
}

/** Run a tool's body: what it returns becomes the JSON result, what it throws an error result. */
export async function toolResult(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify((await body()) ?? null) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

/** Input fields of the tools that locate a task; resolveTaskId reads them. */
export const taskLookup = {
  id: z.number().optional().describe("Task ID"),
  jiraKey: z.string().optional().describe("Jira key to look up task"),
  prNumber: z.number().optional().describe("GitHub PR number"),
  repo: z.string().optional().describe("GitHub repo in owner/repo format (use with prNumber if ambiguous)"),
  branch: z.string().optional().describe("Git branch name (headBranch)"),
};

// Resolve task ID from various identifiers
export async function resolveTaskId(params: {
  id?: number;
  jiraKey?: string;
  prNumber?: number;
  repo?: string; // owner/repo format, used with prNumber
  branch?: string;
}): Promise<number> {
  if (params.id) {
    return params.id;
  }

  if (params.jiraKey) {
    const task = await get<Task>(`/api/v1/tasks/by-jira-key/${encodeURIComponent(params.jiraKey)}`);
    return task.id;
  }

  if (params.prNumber !== undefined) {
    const repoQuery = params.repo ? `?repo=${encodeURIComponent(params.repo)}` : "";
    const task = await get<Task>(`/api/v1/tasks/by-pr/${params.prNumber}${repoQuery}`);
    return task.id;
  }

  if (params.branch) {
    const task = await get<Task>(`/api/v1/tasks/by-branch/${encodeURIComponent(params.branch)}`);
    return task.id;
  }

  throw new Error("One of id, jiraKey, prNumber, or branch is required");
}

// Resolve a repository name to its ID. Accepts "owner/repo", the bare repo
// name, or the repository's alias (all case-insensitive).
export async function resolveRepositoryId(name: string): Promise<number> {
  const { items } = await get<ListResponse<Repository>>("/api/v1/repositories");
  const wanted = name.trim().toLowerCase();

  const matches = items.filter((r) =>
    [`${r.owner}/${r.repo}`, r.repo, r.alias].some((v) => v?.toLowerCase() === wanted)
  );

  const known = items.map((r) => `${r.owner}/${r.repo}${r.alias ? ` (${r.alias})` : ""}`).join(", ");

  if (matches.length === 0) {
    throw new Error(`Unknown repository "${name}". Known repositories: ${known}`);
  }
  if (matches.length > 1) {
    const candidates = matches.map((r) => `${r.owner}/${r.repo}`).join(", ");
    throw new Error(`Ambiguous repository "${name}". Use owner/repo: ${candidates}`);
  }

  return matches[0]!.id;
}
