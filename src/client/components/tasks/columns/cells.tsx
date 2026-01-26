import { Link } from "react-router";
import { Badge } from "@/client/components/ui/badge";
import { StatusBadge } from "../StatusBadge";
import { ChecksStatusCell } from "../ChecksStatusCell";
import { ReviewStatusIcon, PrStatusIcon, UnresolvedCommentsIcon } from "../StatusIcons";
import { RepoBadge } from "../RepoBadge";
import { DeploymentBadges } from "../DeploymentBadges";
import { toast } from "sonner";
import type { Task, Repository } from "@/client/lib/types";

// Build Jira URL - requires jiraHost, returns null if not configured
export function getJiraUrl(jiraKey: string, jiraHost: string | undefined | null): string | null {
  if (!jiraHost) return null;
  const cleanHost = jiraHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanHost}/browse/${jiraKey}`;
}

// Build GitHub PR URL
export function getPrUrl(repo: Repository | undefined | null, prNumber: number | null): string | null {
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
      {task.type.toLowerCase() === "bug" && task.priority && task.priority !== "To be qualified" && (
        <Badge
          className={`text-xs ${
            task.priority === "P0" ? "bg-red-600 text-white hover:bg-red-600" :
            task.priority === "P1" ? "bg-red-500 text-white hover:bg-red-500" :
            task.priority === "P2" ? "bg-red-400 text-white hover:bg-red-400" :
            task.priority === "P3" ? "bg-yellow-600 text-white hover:bg-yellow-600" :
            task.priority === "P4" ? "bg-blue-500 text-white hover:bg-blue-500" :
            ""
          }`}
        >
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
      {task.sprint}
    </span>
  );
}

export function EpicCell({ task, jiraHost }: { task: Task; jiraHost?: string | null }) {
  if (!task.epicKey) {
    return <span className="text-muted-foreground">—</span>;
  }
  const epicUrl = getJiraUrl(task.epicKey, jiraHost);
  if (epicUrl) {
    return (
      <a
        href={epicUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {task.epicKey}
      </a>
    );
  }
  return <span className="font-mono text-xs">{task.epicKey}</span>;
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
  if (linkToTask) {
    return (
      <Link
        to={`/tasks/${task.id}`}
        className="hover:underline truncate block"
        title={task.title}
      >
        {task.title}
      </Link>
    );
  }
  return (
    <span className="truncate block" title={task.title}>
      {task.title}
    </span>
  );
}

export function RepoCell({ repo }: { repo?: Repository }) {
  if (!repo) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <RepoBadge repo={repo} />;
}

export function BranchCell({ task }: { task: Task }) {
  if (!task.headBranch) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <button
      type="button"
      className="font-mono text-xs hover:text-blue-600 cursor-pointer text-left truncate block"
      title={task.headBranch}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(task.headBranch!);
        toast.success("Branch copied to clipboard");
      }}
    >
      {task.headBranch}
    </button>
  );
}

export function PrCell({ task, prUrl }: { task: Task; prUrl?: string | null }) {
  if (!task.prNumber) {
    return <span className="text-muted-foreground">—</span>;
  }
  const content = (
    <>
      <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
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
  return <StatusBadge status={task.status} />;
}

export function MergedInCell({ task }: { task: Task }) {
  return <DeploymentBadges branches={task.onDeploymentBranches} />;
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

export function ReviewsCell({ task, prUrl }: { task: Task; prUrl?: string | null }) {
  return (
    <ReviewStatusIcon
      approvedCount={task.approvedReviewCount}
      prUrl={prUrl}
    />
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
