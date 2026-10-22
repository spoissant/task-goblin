import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { StatusCategory } from "@/shared/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Normalize status name for comparison (case-insensitive) */
export function normalizeStatus(status: string): string {
  return status.toLowerCase();
}

/** The category a status belongs to: its own name or one of its Jira mappings, ignoring case. */
export function findStatusCategory(status: string, categories: StatusCategory[]): StatusCategory | undefined {
  const s = normalizeStatus(status);
  return categories.find((c) => normalizeStatus(c.name) === s || c.jiraMappings.some((m) => normalizeStatus(m) === s));
}
