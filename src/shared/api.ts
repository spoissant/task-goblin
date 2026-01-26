// Shared API utilities for client and MCP

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

export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.error?.code || "UNKNOWN_ERROR",
      body.error?.message || response.statusText
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}
