import { CheckCircle, XCircle, GitMerge, FileEdit } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

interface ReviewStatusIconProps {
  approvedCount: number | null;
}

export function ReviewStatusIcon({ approvedCount }: ReviewStatusIconProps) {
  if (approvedCount === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const required = 2;
  const countText = `${approvedCount}/${required}`;

  if (approvedCount >= required) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-default">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-xs">{countText}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {approvedCount} approving reviews
        </TooltipContent>
      </Tooltip>
    );
  }

  if (approvedCount === 1) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-default">
            <CheckCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-xs">{countText}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          1 approving review (needs 2)
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 cursor-default">
          <XCircle className="h-4 w-4 text-red-500" />
          <span className="text-xs">{countText}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        No approving reviews
      </TooltipContent>
    </Tooltip>
  );
}

interface PrStatusIconProps {
  prState: string | null;
  isDraft: number | null;
}

export function PrStatusIcon({ prState, isDraft }: PrStatusIconProps) {
  if (isDraft) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <FileEdit className="h-4 w-4 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Draft PR
        </TooltipContent>
      </Tooltip>
    );
  }

  if (prState === "merged") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <GitMerge className="h-4 w-4 text-purple-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Merged
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">
          <CheckCircle className="h-4 w-4 text-green-500" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Open PR
      </TooltipContent>
    </Tooltip>
  );
}
