// Reading the JSON stored in task columns and settings, which may be empty or malformed.

/** The parsed value, or `fallback` when `value` is empty or not valid JSON. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** A JSON array of strings (logins, branch names, PR keys); anything else reads as empty. */
export function parseStringList(value: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}
