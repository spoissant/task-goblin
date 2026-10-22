import { error } from "./response";
import { AppError } from "./lib/errors";

export async function withErrorBoundary(
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof AppError) {
      return error(err);
    }
    console.error("Unexpected error:", err);
    return error(new Error("Internal server error"));
  }
}
