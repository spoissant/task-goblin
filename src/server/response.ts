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

export function error(err: Error | AppError): Response {
  if (err instanceof AppError) {
    return json(
      { error: { code: err.code, message: err.message } },
      err.statusCode
    );
  }
  console.error("Unexpected error:", err);
  return json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    500
  );
}

export function notFound(message: string = "Not found"): Response {
  return json({ error: { code: "NOT_FOUND", message } }, 404);
}

export function badRequest(message: string): Response {
  return json({ error: { code: "BAD_REQUEST", message } }, 400);
}
