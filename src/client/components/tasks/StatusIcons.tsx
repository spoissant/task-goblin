import { CheckCircle, XCircle, GitMerge, GitPullRequestClosed, FileEdit, MessageSquare, Ban } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

interface ReviewStatusIconProps {
  approvedCount: number | null;
  prUrl?: string | null;
}

export function ReviewStatusIcon({ approvedCount, prUrl }: ReviewStatusIconProps) {
  if (approvedCount === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const required = 2;
  const countText = `${approvedCount}/${required}`;
  const cursorClass = prUrl ? "cursor-pointer" : "cursor-default";
  const handleClick = prUrl ? () => window.open(prUrl, "_blank") : undefined;

  if (approvedCount >= required) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 ${cursorClass}`} onClick={handleClick}>
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
          <span className={`inline-flex items-center gap-1 ${cursorClass}`} onClick={handleClick}>
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
        <span className={`inline-flex items-center gap-1 ${cursorClass}`} onClick={handleClick}>
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
  // Check terminal states first (take precedence over draft)
  if (prState === "merged") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <GitMerge className="h-4 w-4 text-purple-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Merged</TooltipContent>
      </Tooltip>
    );
  }

  if (prState === "closed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <GitPullRequestClosed className="h-4 w-4 text-red-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Closed</TooltipContent>
      </Tooltip>
    );
  }

  if (isDraft) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">
            <FileEdit className="h-4 w-4 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Draft PR</TooltipContent>
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

interface UnresolvedCommentsIconProps {
  count: number | null;
  prUrl?: string | null;
}

export function UnresolvedCommentsIcon({ count, prUrl }: UnresolvedCommentsIconProps) {
  if (count === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const cursorClass = prUrl ? "cursor-pointer" : "cursor-default";
  const handleClick = prUrl ? () => window.open(prUrl, "_blank") : undefined;

  if (count === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center ${cursorClass}`} onClick={handleClick}>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>All comments resolved</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 ${cursorClass}`} onClick={handleClick}>
          <MessageSquare className="h-4 w-4 text-yellow-500" />
          <span className="text-xs">{count}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {count} unresolved comment{count !== 1 ? "s" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

interface BlockerStatusIconProps {
  blockerCount: number;
  completedBlockerCount: number;
  onClick?: (e?: React.MouseEvent) => void;
}

export function BlockerStatusIcon({ blockerCount, completedBlockerCount, onClick }: BlockerStatusIconProps) {
  const cursorClass = onClick ? "cursor-pointer hover:opacity-80" : "cursor-default";

  // No blockers - show green checkmark alone
  if (blockerCount === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground ${cursorClass}`}
            onClick={onClick}
          >
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>No blockers</TooltipContent>
      </Tooltip>
    );
  }

  const countText = `${completedBlockerCount}/${blockerCount}`;

  // All blockers complete - green
  if (completedBlockerCount === blockerCount) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 ${cursorClass}`}
            onClick={onClick}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {countText}
          </span>
        </TooltipTrigger>
        <TooltipContent>All blockers resolved</TooltipContent>
      </Tooltip>
    );
  }

  // No blockers complete - red
  if (completedBlockerCount === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 ${cursorClass}`}
            onClick={onClick}
          >
            <Ban className="h-3.5 w-3.5" />
            {countText}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {blockerCount} unresolved blocker{blockerCount !== 1 ? "s" : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Partial - yellow
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 ${cursorClass}`}
          onClick={onClick}
        >
          <CheckCircle className="h-3.5 w-3.5" />
          {countText}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {completedBlockerCount} of {blockerCount} blockers resolved
      </TooltipContent>
    </Tooltip>
  );
}
