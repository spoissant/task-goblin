import { Badge } from "@/client/components/ui/badge";
import { cn } from "@/client/lib/utils";
import { useStatusConfigQuery } from "@/client/lib/queries/settings";
import type { StatusConfig } from "@/client/lib/types";

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
  const { data } = useStatusConfigQuery();

  const getStatusConfig = (status: string): { label: string; color: string } => {
    const normalized = normalizeStatus(status);

    if (data?.statuses) {
      // Build a lookup function that checks both name and jiraMapping
      const findMatchingConfig = (): StatusConfig | undefined => {
        for (const config of data.statuses) {
          // Check our status name
          if (normalizeStatus(config.name) === normalized) {
            return config;
          }
          // Check jiraMapping array
          if (config.jiraMapping) {
            for (const jiraStatus of config.jiraMapping) {
              if (normalizeStatus(jiraStatus) === normalized) {
                return config;
              }
            }
          }
        }
        return undefined;
      };

      const matchedConfig = findMatchingConfig();
      if (matchedConfig) {
        return {
          label: status, // Keep original label (e.g., show "Ready for Test" not "QA")
          color: matchedConfig.color || data.defaultColor || FALLBACK_COLOR,
        };
      }

      // Fallback for unknown status - use default status's color
      const defaultStatus = data.statuses.find(s => s.isDefault);
      if (defaultStatus) {
        return {
          label: status,
          color: defaultStatus.color || data.defaultColor || FALLBACK_COLOR,
        };
      }
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
