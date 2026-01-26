export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string = "INTERNAL_ERROR"
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string | number) {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

// Type guard for API errors from external services (Jira, GitHub)
export interface ApiError {
  status?: number;
  message?: string;
}

export function isApiError(err: unknown): err is ApiError {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const obj = err as Record<string, unknown>;
  const hasValidStatus = typeof obj.status === "number";
  const hasValidMessage = typeof obj.message === "string";
  // Require at least one of status or message to be defined
  return hasValidStatus || hasValidMessage;
}
