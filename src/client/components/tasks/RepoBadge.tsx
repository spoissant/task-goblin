import { Badge } from "@/client/components/ui/badge";
import type { Repository } from "@/client/lib/types";

// Predefined color options for repository badges
export const BADGE_COLORS = {
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  lime: "bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
} as const;

export type BadgeColorName = keyof typeof BADGE_COLORS;

const DEFAULT_COLOR: BadgeColorName = "gray";

interface RepoBadgeProps {
  repo: Repository;
}

export function RepoBadge({ repo }: RepoBadgeProps) {
  const colorName = (repo.badgeColor as BadgeColorName) || DEFAULT_COLOR;
  const colorClasses = BADGE_COLORS[colorName] || BADGE_COLORS[DEFAULT_COLOR];

  return (
    <Badge variant="outline" className={`text-xs border-transparent ${colorClasses}`}>
      {repo.repo}
    </Badge>
  );
}
