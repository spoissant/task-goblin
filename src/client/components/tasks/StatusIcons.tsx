import { CheckCircle, CircleDashed, XCircle, GitMerge, GitPullRequestClosed, FileEdit, MessageSquare, AlertTriangle, Shield, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { reviewGaps, type ReviewGap, type ReviewStatus } from "@/shared/review-status";

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;

interface LineDisplay {
  Icon: LucideIcon;
  color: string;
  text: string;
  tooltip: string;
  /** Your review unblocks the merge. */
  mine?: boolean;
  /** Asked for, but doesn't gate the merge. */
  muted?: boolean;
}

function describeGap(gap: ReviewGap, status: ReviewStatus, highlight: string[]): LineDisplay {
  switch (gap.kind) {
    case "changes":
      return { Icon: XCircle, color: "text-red-500", text: gap.who, tooltip: `Changes requested by ${gap.who}` };
    case "approvals":
      return {
        Icon: CircleDashed,
        color: "text-yellow-500",
        text: `+${plural(gap.count, "approval")}`,
        tooltip: `${status.approvedCount} of ${plural(status.requiredApprovals, "required approval")}`,
      };
    case "codeOwner": {
      const mine = highlight.includes(gap.name);
      return {
        Icon: ShieldAlert,
        color: mine ? "text-red-500" : "text-yellow-500",
        text: gap.name,
        tooltip: `Code owner approval missing: ${gap.name}${mine ? " (yours)" : ""}`,
        mine,
      };
    }
    case "review":
      return {
        Icon: CircleDashed,
        color: "text-yellow-500",
        text: "Review required",
        tooltip: "GitHub still requires a review: open the PR to see which",
      };
  }
}

interface ReviewStatusIconProps {
  status: ReviewStatus | null;
  prUrl?: string | null;
  /** Missing code owners to flag as yours (you or your teams): your review unblocks the merge. */
  highlight?: string[];
}

/**
 * Whether the PR's reviews let it merge once checks pass, as GitHub decides
 * it, and otherwise one line per thing still missing. Unresolved threads have
 * their own column and don't count here.
 */
export function ReviewStatusIcon({ status, prUrl, highlight = [] }: ReviewStatusIconProps) {
  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }

  const gaps = reviewGaps(status);
  const lines = gaps.map((gap) => describeGap(gap, status, highlight));
  // A courtesy request still tells you who was asked, e.g. on a PR stacked on a feature branch.
  for (const name of status.optionalCodeOwners) {
    lines.push({
      Icon: Shield,
      color: "text-muted-foreground/50",
      text: name,
      tooltip: `Code owner review requested, not required to merge${status.baseBranch ? ` into ${status.baseBranch}` : ""}`,
      muted: true,
    });
  }

  const content = (
    <span className="inline-flex flex-col gap-0.5">
      {!gaps.length && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <CheckCircle className="h-4 w-4 text-green-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {status.decision ? `Reviews done: ${plural(status.approvedCount, "approval")}` : "No review required"}
          </TooltipContent>
        </Tooltip>
      )}
      {lines.map(({ Icon, color, text, tooltip, mine, muted }, i) => (
        <Tooltip key={`${i}:${text}`}>
          <TooltipTrigger asChild>
            <span
              className={`inline-flex items-center gap-1 text-xs${mine ? " font-semibold" : ""}${muted ? " text-muted-foreground" : ""}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${color}`} />
              {/* Long team slugs wrap at their hyphens: truncating them would make sibling teams look alike. */}
              <span className="max-w-48 whitespace-normal">{text}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );

  return prUrl ? (
    <a href={prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
      {content}
    </a>
  ) : (
    content
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

export function MergeConflictIcon() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Has merge conflicts</TooltipContent>
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

  let icon: React.ReactNode;
  let tooltip: string;

  if (count === 0) {
    icon = <CheckCircle className="h-4 w-4 text-green-500" />;
    tooltip = "All comments resolved";
  } else {
    icon = <MessageSquare className="h-4 w-4 text-yellow-500" />;
    tooltip = `${count} unresolved comment${count !== 1 ? "s" : ""}`;
  }

  const trigger = (
    <span className={`inline-flex items-center${count > 0 ? " gap-1" : ""}`}>
      {icon}
      {count > 0 && <span className="text-xs">{count}</span>}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {prUrl ? <a href={prUrl} target="_blank" rel="noopener noreferrer">{trigger}</a> : trigger}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

