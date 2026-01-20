import { CheckCircle, XCircle, Loader2, Circle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import type { CheckDetail } from "@/client/lib/types";

interface ChecksStatusCellProps {
  checksStatus: string | null;
  checksDetails: string | null;
  prUrl?: string | null;
}

function getCheckIcon(status: string, conclusion: string | null) {
  if (status !== "completed") {
    return <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" />;
  }
  if (conclusion === "success" || conclusion === "skipped" || conclusion === "neutral") {
    return <CheckCircle className="h-3 w-3 text-green-500" />;
  }
  if (conclusion === "failure" || conclusion === "timed_out") {
    return <XCircle className="h-3 w-3 text-red-500" />;
  }
  return <Circle className="h-3 w-3 text-muted-foreground" />;
}

function getStatusIcon(status: string | null) {
  if (!status) return null;

  switch (status) {
    case "passed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "pending":
      return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

function parseChecksDetails(checksDetails: string | null): CheckDetail[] {
  if (!checksDetails) return [];
  try {
    return JSON.parse(checksDetails) as CheckDetail[];
  } catch {
    return [];
  }
}

function countChecks(details: CheckDetail[]): { passed: number; total: number } {
  const total = details.length;
  const passed = details.filter(
    (check) =>
      check.status === "completed" &&
      (check.conclusion === "success" || check.conclusion === "skipped" || check.conclusion === "neutral")
  ).length;
  return { passed, total };
}

export function ChecksStatusCell({ checksStatus, checksDetails, prUrl }: ChecksStatusCellProps) {
  const icon = getStatusIcon(checksStatus);
  if (!icon) {
    return <span className="text-muted-foreground">-</span>;
  }

  const details = parseChecksDetails(checksDetails);
  const { passed, total } = countChecks(details);
  const countText = total > 0 ? `${passed}/${total}` : null;
  const cursorClass = prUrl ? "cursor-pointer" : "cursor-default";
  const handleClick = prUrl ? () => window.open(prUrl, "_blank") : undefined;

  if (details.length === 0) {
    return (
      <span className={`inline-flex ${cursorClass}`} onClick={handleClick}>
        {icon}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 ${cursorClass}`} onClick={handleClick}>
          {icon}
          {countText && <span className="text-xs">{countText}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        <div className="space-y-1">
          <div className="font-medium text-xs mb-1">CI Checks ({passed}/{total})</div>
          {details.map((check, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              {getCheckIcon(check.status, check.conclusion)}
              {check.url ? (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline truncate max-w-[200px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {check.name}
                </a>
              ) : (
                <span className="truncate max-w-[200px]">{check.name}</span>
              )}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
