import { AppError } from "./lib/errors";

export function json<T>(data: T, status: number = 200): Response {
  return Response.json(data, { status });
}

export function created<T>(data: T): Response {
  return json(data, 201);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

interface ErrorDetails {
  [key: string]: unknown;
}

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetails;
  };
}

export function error(
  err: Error | AppError,
  details?: ErrorDetails
): Response {
  if (err instanceof AppError) {
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message },
    };
    if (details) {
      body.error.details = details;
    }
    return json(body, err.statusCode);
  }
  // Unexpected errors - don't log here, middleware handles it
  return json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    500
  );
}

