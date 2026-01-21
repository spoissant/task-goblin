import { Badge } from "@/client/components/ui/badge";
import { cn } from "@/client/lib/utils";
import { useStatusConfigQuery } from "@/client/lib/queries/settings";

// Fallback config for when query is loading or unknown status
const FALLBACK_COLOR = "bg-slate-500";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { data } = useStatusConfigQuery();

  const getStatusConfig = (status: string): { label: string; color: string } => {
    const s = status.toLowerCase();
    const normalizedS = s.replace(/_/g, " ");

    // Try to find in config
    if (data?.statuses) {
      for (const config of data.statuses) {
        const configName = config.name.toLowerCase();
        if (configName === s || configName === normalizedS) {
          return {
            label: config.name,
            color: config.color || data.defaultColor || FALLBACK_COLOR,
          };
        }
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
