import { Badge } from "@/client/components/ui/badge";
import { cn } from "@/client/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  todo: { label: "To Do", color: "bg-slate-500" },
  in_progress: { label: "In Progress", color: "bg-fuchsia-500" },
  code_review: { label: "Code Review", color: "bg-yellow-600" },
  qa: { label: "QA", color: "bg-blue-600" },
  done: { label: "Done", color: "bg-green-700" },
  canceled: { label: "Canceled", color: "bg-green-700" },
  closed: { label: "Closed", color: "bg-green-700" },
  blocked: { label: "Blocked", color: "bg-red-500" },
};

function getStatusConfig(status: string): { label: string; color: string } {
  // Exact match first
  if (STATUS_CONFIG[status]) {
    return STATUS_CONFIG[status];
  }

  // Fuzzy match for Jira status variations
  const s = status.toLowerCase();
  if (s.includes("ready to merge") || s.includes("ready to prod") || s.includes("canceled") || s.includes("closed") || s === "done") {
    return { label: status, color: "bg-green-700" };
  }
  if (s.includes("code_review") || s.includes("code review")) {
    return { label: status, color: "bg-yellow-600" };
  }
  if (s.includes("in_progress") || s.includes("in progress")) {
    return { label: status, color: "bg-fuchsia-500" };
  }
  if (s.includes("qa") || s.includes("ready for test")) {
    return { label: status, color: "bg-blue-600" };
  }
  if (s.includes("blocked")) {
    return { label: status, color: "bg-red-500" };
  }

  // Default
  return { label: status, color: "bg-slate-500" };
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = getStatusConfig(status);

  return (
    <Badge className={cn(config.color, "text-white whitespace-nowrap", className)}>
      {config.label.replace("_", " ")}
    </Badge>
  );
}
