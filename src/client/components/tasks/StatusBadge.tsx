import { Badge } from "@/client/components/ui/badge";
import { cn, findStatusCategory } from "@/client/lib/utils";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";

// Fallback config for when query is loading or unknown status
const FALLBACK_COLOR = "bg-slate-500";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

/** The status as it reads (e.g. "Ready for Test", not "QA"), in its category's color. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { data } = useStatusSettingsQuery();
  const color = findStatusCategory(status, data?.categories ?? [])?.color || data?.defaultColor || FALLBACK_COLOR;

  return (
    <Badge className={cn(color, "text-white whitespace-nowrap", className)}>
      {status}
    </Badge>
  );
}
