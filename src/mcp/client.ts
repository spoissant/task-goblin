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

// Types
export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithRelations extends Task {
  todos: Todo[];
  branches: Branch[];
  jiraItems: JiraItem[];
  blockedBy: BlockedByRecord[];
}

export interface Todo {
  id: number;
  content: string;
  done: string | null;
  taskId: number | null;
  branchId: number | null;
  jiraItemId: number | null;
  pullRequestId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: number;
  name: string;
  repositoryId: number;
  taskId: number | null;
  pullRequestId: number | null;
}

export interface JiraItem {
  id: number;
  key: string;
  summary: string;
  status: string | null;
  assignee: string | null;
  taskId: number | null;
  createdAt: string;
  updatedAt: string;
  task?: Task | null;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  headBranch: string;
  baseBranch: string;
  repositoryId: number;
  createdAt: string;
  updatedAt: string;
  repository?: Repository | null;
  branches?: Branch[];
}

export interface Repository {
  id: number;
  owner: string;
  repo: string;
}

export interface BlockedByRecord {
  id: number;
  blockedTaskId: number | null;
  blockedBranchId: number | null;
  blockerTaskId: number | null;
  blockerTodoId: number | null;
  blockerBranchId: number | null;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

// Jira sync helpers
export async function getOrSyncJira(key: string): Promise<JiraItem> {
  try {
    return await get<JiraItem>(`/api/v1/jira/items/key/${key}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Sync from Jira API and retry
      await post(`/api/v1/refresh/jira/${key}`);
      return await get<JiraItem>(`/api/v1/jira/items/key/${key}`);
    }
    throw err;
  }
}

// GitHub PR sync helpers
export async function getOrSyncPR(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequest> {
  try {
    return await get<PullRequest>(
      `/api/v1/github/repos/${owner}/${repo}/pull-requests/${number}`
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Sync from GitHub API and retry
      await post(`/api/v1/refresh/github/${owner}/${repo}/${number}`);
      return await get<PullRequest>(
        `/api/v1/github/repos/${owner}/${repo}/pull-requests/${number}`
      );
    }
    throw err;
  }
}

// Resolve task ID from various identifiers
export async function resolveTaskId(params: {
  id?: number;
  jiraKey?: string;
  prNumber?: number;
  prRepo?: string;
}): Promise<number> {
  if (params.id) {
    return params.id;
  }

  if (params.jiraKey) {
    const jiraItem = await getOrSyncJira(params.jiraKey);
    if (!jiraItem.taskId) {
      throw new Error(`Jira item ${params.jiraKey} is not linked to a task`);
    }
    return jiraItem.taskId;
  }

  if (params.prNumber && params.prRepo) {
    const [owner, repo] = params.prRepo.split("/");
    if (!owner || !repo) {
      throw new Error("prRepo must be in format 'owner/repo'");
    }
    const pr = await getOrSyncPR(owner, repo, params.prNumber);
    if (!pr.branches || pr.branches.length === 0 || !pr.branches[0].taskId) {
      throw new Error(
        `PR ${params.prRepo}#${params.prNumber} is not linked to a task`
      );
    }
    return pr.branches[0].taskId;
  }

  throw new Error("One of id, jiraKey, or prNumber+prRepo is required");
}
