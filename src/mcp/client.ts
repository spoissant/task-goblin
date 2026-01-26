import { ApiError, handleResponse } from "@/shared/api";
import type {
  Task,
  TaskWithRepository,
  Todo,
  BlockedBy,
  Repository,
  ListResponse,
  SyncResult,
  SplitResult,
} from "@/shared/types";

export { ApiError };

// Re-export types for MCP tools
export type { Task, TaskWithRepository, Todo, BlockedBy, Repository, ListResponse, SyncResult, SplitResult };

// MCP-specific types
export interface BlockedByRecord {
  id: number;
  blockedTaskId: number | null;
  blockerTaskId: number | null;
  blockerTodoId: number | null;
}

export interface TaskWithRelations extends TaskWithRepository {
  todos: Todo[];
  blockedBy: BlockedByRecord[];
}

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

// Resolve task ID from various identifiers
export async function resolveTaskId(params: {
  id?: number;
  jiraKey?: string;
}): Promise<number> {
  if (params.id) {
    return params.id;
  }

  if (params.jiraKey) {
    // Use the new endpoint that looks up task by jiraKey
    const task = await get<Task>(`/api/v1/tasks/by-jira-key/${encodeURIComponent(params.jiraKey)}`);
    return task.id;
  }

  throw new Error("One of id or jiraKey is required");
}
