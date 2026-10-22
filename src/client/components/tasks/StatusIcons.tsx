import { CheckCircle, CircleDashed, XCircle, GitMerge, GitPullRequestClosed, FileEdit, MessageSquare, AlertTriangle, Shield, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { reviewGaps, type ReviewGap, type ReviewStatus } from "@/shared/review-status";
import { cn } from "@/client/lib/utils";

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
        color: "text-red-500",
        text: `+${plural(gap.count, "approval")}`,
        tooltip: `${status.approvedCount} of ${plural(status.requiredApprovals, "required approval")}`,
      };
    case "codeOwner": {
      const mine = highlight.includes(gap.name);
      return {
        Icon: ShieldAlert,
        color: "text-red-500",
        text: gap.name,
        tooltip: `Code owner approval missing: ${gap.name}${mine ? " (yours)" : ""}`,
        mine,
      };
    }
    case "review":
      return {
        Icon: CircleDashed,
        color: "text-red-500",
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

/** A 16px icon that explains itself in a tooltip. */
export function IconTip({ icon: Icon, tip, className }: { icon: LucideIcon; tip: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">
          <Icon className={cn("h-4 w-4", className)} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

const PR_STATE_ICONS = {
  merged: { icon: GitMerge, className: "text-purple-500", tip: "Merged" },
  closed: { icon: GitPullRequestClosed, className: "text-red-500", tip: "Closed" },
  draft: { icon: FileEdit, className: "text-muted-foreground", tip: "Draft PR" },
  open: { icon: CheckCircle, className: "text-green-500", tip: "Open PR" },
};

interface PrStatusIconProps {
  prState: string | null;
  isDraft: number | null;
}

export function PrStatusIcon({ prState, isDraft }: PrStatusIconProps) {
  // Terminal states take precedence over draft
  const state = prState === "merged" || prState === "closed" ? prState : isDraft ? "draft" : "open";
  return <IconTip {...PR_STATE_ICONS[state]} />;
}

export function MergeConflictIcon() {
  return <IconTip icon={AlertTriangle} className="text-orange-500" tip="Has merge conflicts" />;
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
