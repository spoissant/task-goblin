import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/client/components/ui/badge";
import { InteractiveStatusBadge } from "../InteractiveStatusBadge";
import { ChecksStatusCell } from "../ChecksStatusCell";
import { ReviewStatusIcon, PrStatusIcon, UnresolvedCommentsIcon, MergeConflictIcon } from "../StatusIcons";
import { RepoBadge } from "../RepoBadge";
import { DevStackToggle } from "../DevStackToggle";
import { DeploymentBadges } from "../DeploymentBadges";
import { Flame, ListTree, Snowflake, Zap } from "lucide-react";
import type { Task, Repository } from "@/client/lib/types";
import { useUpdateTask } from "@/client/lib/queries/tasks";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { Linkify } from "@/client/components/ui/Linkify";
import { CopyChip } from "@/client/components/ui/copy-chip";
import { AssignPrDialog } from "../AssignPrDialog";

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-600 text-white hover:bg-red-600",
  P1: "bg-red-500 text-white hover:bg-red-500",
  P2: "bg-red-400 text-white hover:bg-red-400",
  P3: "bg-yellow-600 text-white hover:bg-yellow-600",
  P4: "bg-blue-500 text-white hover:bg-blue-500",
};

// Build Jira URL - requires jiraHost, returns null if not configured
export function getJiraUrl(jiraKey: string, jiraHost: string | undefined | null): string | null {
  if (!jiraHost) return null;
  const cleanHost = jiraHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanHost}/browse/${jiraKey}`;
}

// Build GitHub PR URL
export function getPrUrl(repo: Pick<Repository, "owner" | "repo"> | undefined | null, prNumber: number | null): string | null {
  if (!repo || !prNumber) return null;
  return `https://github.com/${repo.owner}/${repo.repo}/pull/${prNumber}`;
}

export function TypeCell({ task }: { task: Task }) {
  if (!task.type) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="text-xs">{task.type}</Badge>
      {task.priority && task.priority !== "To be qualified" && (
        <Badge className={`text-xs ${PRIORITY_COLORS[task.priority] ?? ""}`}>
          {task.priority}
        </Badge>
      )}
    </div>
  );
}

export function SprintCell({ task }: { task: Task }) {
  if (!task.sprint) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="truncate block" title={task.sprint}>
      {task.sprint.replace(/Connect & Learn/g, "C&L")}
    </span>
  );
}

export function ParentCell({ task, jiraHost }: { task: Task; jiraHost?: string | null }) {
  const key = task.epicKey ?? task.parentKey;
  if (!key) {
    return <span className="text-muted-foreground">—</span>;
  }
  const isEpic = task.epicKey != null;
  const url = getJiraUrl(key, jiraHost);
  const content = (
    <span className="inline-flex items-center gap-1">
      {isEpic && <Zap className="h-3 w-3 text-purple-600 shrink-0" />}
      {key}
    </span>
  );
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  return <span className="font-mono text-xs">{content}</span>;
}

export function KeyCell({ task, jiraHost }: { task: Task; jiraHost?: string | null }) {
  if (!task.jiraKey) {
    return <span className="text-muted-foreground">—</span>;
  }
  const jiraUrl = getJiraUrl(task.jiraKey, jiraHost);
  if (jiraUrl) {
    return (
      <a
        href={jiraUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {task.jiraKey}
      </a>
    );
  }
  return <span className="font-mono text-xs">{task.jiraKey}</span>;
}

export function TitleCell({ task, linkToTask }: { task: Task; linkToTask?: boolean }) {
  // High-priority titles borrow the flame icon's color and glow so they stand out in the list.
  const className = `truncate block${task.highPriority ? " text-orange-500 flame-glow" : ""}`;
  if (linkToTask) {
    return (
      <Link to={`/tasks/${task.id}`} className={`hover:underline ${className}`} title={task.title}>
        {task.title}
      </Link>
    );
  }
  return (
    <span className={className} title={task.title}>
      {task.title}
    </span>
  );
}

export function RepoCell({ task, repo }: { task: Task; repo?: Repository }) {
  if (!repo) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <RepoBadge repo={repo} />
      <DevStackToggle task={task} />
    </span>
  );
}

export function BranchCell({ task }: { task: Task }) {
  if (!task.headBranch) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <CopyChip
      value={task.headBranch}
      message="Branch copied to clipboard"
      title={task.headBranch}
      className="truncate block w-full"
    >
      {task.headBranch}
    </CopyChip>
  );
}

export function PrCell({ task, prUrl }: { task: Task; prUrl?: string | null }) {
  const [assignOpen, setAssignOpen] = useState(false);

  if (!task.prNumber) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setAssignOpen(true);
          }}
        >
          Assign
        </Button>
        {assignOpen && (
          <AssignPrDialog
            taskId={task.id}
            open={assignOpen}
            onOpenChange={setAssignOpen}
          />
        )}
      </>
    );
  }
  const content = (
    <>
      <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
      {task.hasConflicts === 1 && <MergeConflictIcon />}
      <span>#{task.prNumber}</span>
    </>
  );
  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      {content}
    </span>
  );
}

export function StatusCell({ task }: { task: Task }) {
  return (
    <InteractiveStatusBadge
      taskId={task.id}
      status={task.status}
      jiraKey={task.jiraKey}
    />
  );
}

export function MergedInCell({ task }: { task: Task }) {
  return <DeploymentBadges branches={task.onDeploymentBranches} labelOnlyBranches={task.labelOnlyDeploymentBranches} deployedBranches={task.deployedOnBranches} />;
}

export function ChecksCell({ task, prUrl }: { task: Task; prUrl?: string | null }) {
  return (
    <ChecksStatusCell
      checksStatus={task.checksStatus}
      checksDetails={task.checksDetails}
      prUrl={prUrl}
    />
  );
}

export function ReviewsCell({ task, prUrl }: { task: Task & { repository?: Repository | null }; prUrl?: string | null }) {
  return (
    <ReviewStatusIcon
      approvedCount={task.approvedReviewCount}
      requiredReviews={task.repository?.requiredReviews ?? 2}
      prUrl={prUrl}
    />
  );
}

export function ChangesCell({ task }: { task: Task }) {
  if (task.changedFiles == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center justify-between text-xs font-mono">
      <Badge variant="outline" className="text-xs px-1.5">{task.changedFiles}</Badge>
      <div className="flex flex-col leading-tight text-right">
        <span className="text-green-600">+{task.additions ?? 0}</span>
        <span className="text-red-600">-{task.deletions ?? 0}</span>
      </div>
    </div>
  );
}

export function CommentsCell({ task, prUrl }: { task: Task; prUrl?: string | null }) {
  return (
    <UnresolvedCommentsIcon
      count={task.unresolvedCommentCount}
      prUrl={prUrl}
    />
  );
}

export function OnIceCell({ task }: { task: Task }) {
  const updateTask = useUpdateTask();
  const isOnIce = !!task.onIce;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(task.onIceReason ?? "");

  const handleOpenChange = (next: boolean) => {
    if (next) setReason(task.onIceReason ?? "");
    setOpen(next);
  };

  const handleFreeze = () => {
    updateTask.mutate(
      { id: task.id, onIce: true, onIceReason: reason.trim() || null },
      { onSuccess: () => setOpen(false) }
    );
  };

  const handleThaw = () => {
    updateTask.mutate(
      { id: task.id, onIce: false, onIceReason: null },
      { onSuccess: () => setOpen(false) }
    );
  };

  const button = (
    <button
      type="button"
      className="cursor-pointer hover:opacity-80"
      onClick={(e) => {
        e.stopPropagation();
        handleOpenChange(true);
      }}
    >
      <Snowflake
        className={`h-4 w-4 transition-colors ${
          isOnIce
            ? "text-sky-400 fill-sky-400/30 ice-glow"
            : "text-muted-foreground/30"
        }`}
      />
    </button>
  );

  return (
    <>
      {isOnIce && task.onIceReason ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap">
            <Linkify>{task.onIceReason}</Linkify>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{isOnIce ? "On ice" : "Put task on ice"}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this task on ice? (links allowed)"
            rows={5}
            autoFocus
          />
          <DialogFooter>
            {isOnIce && (
              <Button variant="outline" onClick={handleThaw} disabled={updateTask.isPending}>
                Thaw
              </Button>
            )}
            <Button onClick={handleFreeze} disabled={updateTask.isPending}>
              {isOnIce ? "Save" : "Freeze"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HighPriorityCell({ task }: { task: Task }) {
  const updateTask = useUpdateTask();
  const isHigh = !!task.highPriority;

  return (
    <button
      type="button"
      className="cursor-pointer hover:opacity-80"
      onClick={(e) => {
        e.stopPropagation();
        updateTask.mutate({ id: task.id, highPriority: !isHigh });
      }}
    >
      <Flame
        className={`h-4 w-4 transition-colors ${
          isHigh
            ? "text-orange-500 fill-orange-500 flame-glow"
            : "text-muted-foreground/30"
        }`}
      />
    </button>
  );
}

// Derived flag (not editable): the task has sub-tasks or child issues.
export function IsParentCell({ isParent }: { isParent?: boolean }) {
  if (!isParent) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ListTree className="h-4 w-4 text-violet-400" />
      </TooltipTrigger>
      <TooltipContent>Has sub-tasks</TooltipContent>
    </Tooltip>
  );
}
