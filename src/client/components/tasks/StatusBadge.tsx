import { Badge } from "@/client/components/ui/badge";
import { cn } from "@/client/lib/utils";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import type { StatusCategory } from "@/client/lib/types";

// Fallback config for when query is loading or unknown status
const FALLBACK_COLOR = "bg-slate-500";

// Normalize status name for comparison (case-insensitive, handles underscore/space variants)
function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { data } = useStatusSettingsQuery();

  const getStatusConfig = (status: string): { label: string; color: string } => {
    const normalized = normalizeStatus(status);

    if (data?.categories) {
      // Build a lookup function that checks both name and jiraMappings
      const findMatchingCategory = (): StatusCategory | undefined => {
        for (const category of data.categories) {
          // Check category name
          if (normalizeStatus(category.name) === normalized) {
            return category;
          }
          // Check jiraMappings array
          for (const jiraStatus of category.jiraMappings) {
            if (normalizeStatus(jiraStatus) === normalized) {
              return category;
            }
          }
        }
        return undefined;
      };

      const matchedCategory = findMatchingCategory();
      if (matchedCategory) {
        return {
          label: status, // Keep original label (e.g., show "Ready for Test" not "QA")
          color: matchedCategory.color,
        };
      }

      // Fallback for unknown status - use default color
      return {
        label: status,
        color: data.defaultColor || FALLBACK_COLOR,
      };
    }

    // Final fallback - use default color or hardcoded fallback
    return {
      label: status,
      color: data?.defaultColor || FALLBACK_COLOR,
    };
  };

  const config = getStatusConfig(status);

  return (
    <Badge className={cn(config.color, "text-white whitespace-nowrap", className)}>
      {config.label}
    </Badge>
  );
}
