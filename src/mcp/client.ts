const BASE_URL = process.env.API_URL || "http://localhost:3456";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.error?.code || "UNKNOWN_ERROR",
      body.error?.message || res.statusText
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

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

// Types - Unified Task model
export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  // Jira fields (nullable)
  jiraKey: string | null;
  type: string | null;
  assignee: string | null;
  priority: string | null;
  sprint: string | null;
  epicKey: string | null;
  lastComment: string | null;
  jiraSyncedAt: string | null;
  // GitHub/PR fields (nullable)
  prNumber: number | null;
  repositoryId: number | null;
  headBranch: string | null;
  baseBranch: string | null;
  prState: string | null;
  prAuthor: string | null;
  isDraft: number | null;
  checksStatus: string | null;
  reviewStatus: string | null;
  prSyncedAt: string | null;
}

export interface Repository {
  id: number;
  owner: string;
  repo: string;
}

export interface TaskWithRepository extends Task {
  repository?: Repository | null;
}

export interface Todo {
  id: number;
  content: string;
  done: string | null;
  taskId: number | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export interface SyncResult {
  synced: number;
  errors: string[];
}

export interface MergeResult {
  merged: Task;
}

export interface SplitResult {
  original: Task;
  newPrTask: Task;
}

export interface AutoMatchResult {
  matches: Array<{ jiraTaskId: number; prTaskId: number; jiraKey: string }>;
  total: number;
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
