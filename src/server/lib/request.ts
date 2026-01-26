import { ValidationError } from "./errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBody<T = any>(req: Request): Promise<T> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}
