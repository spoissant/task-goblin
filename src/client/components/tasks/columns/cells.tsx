import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/client/components/ui/badge";
import { ReviewStatusIcon, PrStatusIcon, MergeConflictIcon } from "../StatusIcons";
import { RepoBadge } from "../RepoBadge";
import { DevStackToggle } from "../DevStackToggle";
import { AssignDialog } from "../AssignDialog";
import { AlertTriangle, CornerDownRight, Flame, ListTree, Zap } from "lucide-react";
import { toast } from "sonner";
import type { Task, Repository } from "@/shared/types";
import { parseReviewStatus } from "@/shared/review-status";
import { getJiraUrl } from "@/client/lib/links";
import { useMergePr, useUpdateTask } from "@/client/lib/queries/tasks";
import { usePushTaskWorktree } from "@/client/lib/queries/worktrees";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { Button } from "@/client/components/ui/button";
import { CopyChip } from "@/client/components/ui/copy-chip";

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-600 text-white hover:bg-red-600",
  P1: "bg-red-500 text-white hover:bg-red-500",
  P2: "bg-red-400 text-white hover:bg-red-400",
  P3: "bg-yellow-600 text-white hover:bg-yellow-600",
  P4: "bg-blue-500 text-white hover:bg-blue-500",
};

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

/** A Jira key (or `children`) linking to the issue; plain text while no Jira host is set. */
export function JiraLink({ jiraKey, jiraHost, children }: { jiraKey: string; jiraHost?: string | null; children?: React.ReactNode }) {
  const url = getJiraUrl(jiraKey, jiraHost);
  if (!url) return <span className="font-mono text-xs">{children ?? jiraKey}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline font-mono text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {children ?? jiraKey}
    </a>
  );
}

export function ParentCell({ task, jiraHost }: { task: Task; jiraHost?: string | null }) {
  const key = task.epicKey ?? task.parentKey;
  if (!key) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <JiraLink jiraKey={key} jiraHost={jiraHost}>
      <span className="inline-flex items-center gap-1">
        {task.epicKey != null && <Zap className="h-3 w-3 text-purple-600 shrink-0" />}
        {key}
      </span>
    </JiraLink>
  );
}

/** Opens the dialog that gives the task its Jira key or PR. */
function AssignButton({ kind, taskId }: { kind: "jira" | "pr"; taskId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Assign
      </Button>
      {open && <AssignDialog kind={kind} taskId={taskId} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function KeyCell({ task, jiraHost, canAssign }: { task: Task; jiraHost?: string | null; canAssign: boolean }) {
  if (task.jiraKey) return <JiraLink jiraKey={task.jiraKey} jiraHost={jiraHost} />;
  // A PR task without a key can be given one.
  if (task.prNumber && canAssign) return <AssignButton kind="jira" taskId={task.id} />;
  return <span className="text-muted-foreground">—</span>;
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

export function RepoCell({ task, repo, devStack }: { task: Task; repo?: Repository | null; devStack: boolean }) {
  if (!repo) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <RepoBadge repo={repo} />
      {devStack && <DevStackToggle owner={{ taskId: task.id }} repositoryId={task.repositoryId} label={task.headBranch} />}
    </span>
  );
}

export function BranchCell({ task }: { task: Task }) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      {task.headBranch ? (
        <CopyChip
          value={task.headBranch}
          message="Branch copied to clipboard"
          title={task.headBranch}
          className="truncate block min-w-0"
        >
          {task.headBranch}
        </CopyChip>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <UnpushedWarning task={task} />
    </span>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Warns about worktree work not on the remote; clicking pushes the commits. */
function UnpushedWarning({ task }: { task: Task }) {
  const push = usePushTaskWorktree();
  const unpushed = task.unpushedCommits ?? 0;
  const uncommitted = task.uncommittedFiles ?? 0;
  if (unpushed === 0 && uncommitted === 0) return null;

  const parts = [];
  if (unpushed > 0) parts.push(plural(unpushed, "unpushed commit"));
  if (uncommitted > 0) parts.push(plural(uncommitted, "uncommitted file"));
  const hint = unpushed > 0 ? "click to push" : "commit them in the worktree first";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex shrink-0 ${unpushed > 0 ? "cursor-pointer" : "cursor-default"} ${push.isPending ? "opacity-50" : ""}`}
          aria-label={`${parts.join(", ")}: ${hint}`}
          onClick={(e) => {
            e.stopPropagation();
            if (unpushed === 0 || push.isPending) return;
            push.mutate(task.id, {
              onSuccess: () => toast.success(`Pushed ${task.headBranch ?? "branch"}`),
              onError: (err) => toast.error(err.message),
            });
          }}
        >
          <AlertTriangle className={`h-4 w-4 ${uncommitted > 0 ? "text-red-500" : "text-orange-500"}`} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{parts.join(", ")}: {hint}</TooltipContent>
    </Tooltip>
  );
}

export function PrCell({ task, prUrl, canAssign }: { task: Task; prUrl?: string | null; canAssign: boolean }) {
  if (!task.prNumber) {
    return canAssign ? <AssignButton kind="pr" taskId={task.id} /> : <span className="text-muted-foreground">—</span>;
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

/** The Merge button replaces the review status once the gate cleared the PR (reviews are green by then). */
export function ReviewsCell({ task, prUrl }: { task: Task; prUrl?: string | null }) {
  if (task.mergeReady === 1) return <MergeButton task={task} />;
  return <ReviewStatusIcon status={parseReviewStatus(task.reviewStatus)} prUrl={prUrl} />;
}

/** Shown once the merge gate cleared the PR: squash-merges it. */
function MergeButton({ task }: { task: Task }) {
  const mergePr = useMergePr();
  return (
    <Button
      size="sm"
      className="h-6 px-2 text-xs bg-green-600 text-white hover:bg-green-700"
      disabled={mergePr.isPending}
      onClick={(e) => {
        e.stopPropagation();
        mergePr.mutate(task.id, {
          onSuccess: () => toast.success(`Merged PR #${task.prNumber}`),
          onError: (err) => toast.error(err.message),
        });
      }}
    >
      Merge
    </Button>
  );
}

/** The flame that flags something high priority, lit while it is. */
export function FlameToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="cursor-pointer hover:opacity-80"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Flame
        className={`h-4 w-4 transition-colors ${
          active
            ? "text-orange-500 fill-orange-500 flame-glow"
            : "text-muted-foreground/30"
        }`}
      />
    </button>
  );
}

export function HighPriorityCell({ task }: { task: Task }) {
  const updateTask = useUpdateTask();
  const isHigh = !!task.highPriority;
  return <FlameToggle active={isHigh} onToggle={() => updateTask.mutate({ id: task.id, highPriority: !isHigh })} />;
}

// Derived flags (not editable): the task has sub-tasks or child issues, and/or is itself a sub-task.
// Clicking searches the Jira key, which matches the task and every child (via parent/epic key).
export function IsParentCell({ task, isParent, onSearch }: { task: Task; isParent?: boolean; onSearch?: (query: string) => void }) {
  const parentIcon = isParent && task.jiraKey && (
    <SearchIcon
      icon={<ListTree className="h-4 w-4 text-violet-400" />}
      query={task.jiraKey}
      label="Has sub-tasks"
      searchLabel="Has sub-tasks: show parent + children"
      onSearch={onSearch}
    />
  );
  const subtaskIcon = task.parentKey && (
    <SearchIcon
      icon={<CornerDownRight className="h-4 w-4 text-sky-400" />}
      query={task.parentKey}
      label={`Sub-task of ${task.parentKey}`}
      searchLabel={`Sub-task of ${task.parentKey}: show parent + siblings`}
      onSearch={onSearch}
    />
  );
  if (!parentIcon && !subtaskIcon) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {parentIcon}
      {subtaskIcon}
    </span>
  );
}

function SearchIcon({ icon, query, label, searchLabel, onSearch }: {
  icon: React.ReactNode;
  query: string;
  label: string;
  searchLabel: string;
  onSearch?: (query: string) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onSearch ? (
          <button type="button" className="cursor-pointer hover:opacity-80" onClick={() => onSearch(query)}>
            {icon}
          </button>
        ) : (
          icon
        )}
      </TooltipTrigger>
      <TooltipContent>{onSearch ? searchLabel : label}</TooltipContent>
    </Tooltip>
  );
}
