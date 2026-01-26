import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { Badge } from "@/client/components/ui/badge";
import { StatusBadge } from "./StatusBadge";
import { RepoBadge } from "./RepoBadge";
import { ChecksStatusCell } from "./ChecksStatusCell";
import { ReviewStatusIcon, PrStatusIcon } from "./StatusIcons";
import { DeploymentBadges } from "./DeploymentBadges";
import type { TaskDetail, Repository } from "@/client/lib/types";

interface TaskSummaryBarProps {
  task: TaskDetail;
  repo?: Repository;
  jiraHost?: string;
}

function getJiraUrl(jiraKey: string, jiraHost: string | undefined): string | null {
  if (!jiraHost) return null;
  const cleanHost = jiraHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanHost}/browse/${jiraKey}`;
}

export function TaskSummaryBar({ task, repo, jiraHost }: TaskSummaryBarProps) {
  const prUrl = repo && task.prNumber
    ? `https://github.com/${repo.owner}/${repo.repo}/pull/${task.prNumber}`
    : null;

  const jiraUrl = task.jiraKey ? getJiraUrl(task.jiraKey, jiraHost) : null;

  return (
    <TooltipProvider>
      <div className="rounded-lg border bg-card p-3 overflow-x-auto">
        <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto_auto_auto] gap-4 items-center text-sm min-w-max">
          {/* Type */}
          <div>
            {task.type ? (
              <Badge variant="outline" className="text-xs">{task.type}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Key */}
          <div>
            {task.jiraKey ? (
              jiraUrl ? (
                <a
                  href={jiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
                >
                  {task.jiraKey}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="font-mono text-xs">{task.jiraKey}</span>
              )
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Title */}
          <div className="truncate max-w-[200px]" title={task.title}>
            {task.title}
          </div>

          {/* Repo */}
          <div>
            {repo ? (
              <RepoBadge repo={repo} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Branch */}
          <div>
            {task.headBranch ? (
              <button
                type="button"
                className="font-mono text-xs hover:text-blue-600 cursor-pointer max-w-[120px] truncate block"
                title={task.headBranch}
                onClick={() => {
                  navigator.clipboard.writeText(task.headBranch!);
                  toast.success("Branch copied to clipboard");
                }}
              >
                {task.headBranch}
              </button>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* PR */}
          <div>
            {task.prNumber ? (
              prUrl ? (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
                >
                  <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
                  <span>#{task.prNumber}</span>
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 font-mono text-xs">
                  <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
                  <span>#{task.prNumber}</span>
                </span>
              )
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Status */}
          <div>
            <StatusBadge status={task.status} />
          </div>

          {/* Merged in */}
          <div>
            <DeploymentBadges branches={task.onDeploymentBranches} />
          </div>

          {/* Checks */}
          <div className="flex items-center gap-2">
            <ChecksStatusCell
              checksStatus={task.checksStatus}
              checksDetails={task.checksDetails}
              prUrl={prUrl}
            />
            <ReviewStatusIcon
              approvedCount={task.approvedReviewCount}
              prUrl={prUrl}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
