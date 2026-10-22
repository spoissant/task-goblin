import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { StatusCategory } from "@/shared/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The category a status belongs to: its own name or one of its Jira mappings, ignoring case. */
export function findStatusCategory(status: string, categories: StatusCategory[]): StatusCategory | undefined {
  const s = status.toLowerCase();
  return categories.find((c) => c.name.toLowerCase() === s || c.jiraMappings.some((m) => m.toLowerCase() === s));
}
