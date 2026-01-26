import { ValidationError } from "./errors";

/**
 * Parse a string parameter as an integer ID.
 * Throws ValidationError if the value is not a valid positive integer.
 */
export function parseId(value: string, paramName: string = "id"): number {
  const id = parseInt(value, 10);
  if (Number.isNaN(id) || id < 1) {
    throw new ValidationError(`Invalid ${paramName}: must be a positive integer`);
  }
  return id;
}

/**
 * Pagination limits
 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * Validate and parse pagination parameters.
 * Returns sanitized limit and offset values.
 */
export function validatePagination(
  limitParam: string | null,
  offsetParam: string | null
): { limit: number; offset: number } {
  let limit = DEFAULT_LIMIT;
  let offset = 0;

  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new ValidationError("limit must be a non-negative integer");
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  if (offsetParam !== null) {
    const parsed = parseInt(offsetParam, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new ValidationError("offset must be a non-negative integer");
    }
    offset = parsed;
  }

  return { limit, offset };
}

/**
 * Safely parse a JSON string array from database field.
 * Returns empty array on null/invalid JSON.
 */
export function parseDeploymentBranches(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
