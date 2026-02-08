import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Normalize status name for comparison (case-insensitive, handles underscore/space variants) */
export function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}
