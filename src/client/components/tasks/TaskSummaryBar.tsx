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
        <table className="w-full">
          <thead>
            <tr className="text-xs font-medium text-muted-foreground">
              <th className="text-left pr-4 pb-2">Type</th>
              <th className="text-left pr-4 pb-2">Key</th>
              <th className="text-left pr-4 pb-2">Title</th>
              <th className="text-left pr-4 pb-2">Repo</th>
              <th className="text-left pr-4 pb-2">Branch</th>
              <th className="text-left pr-4 pb-2">PR</th>
              <th className="text-left pr-4 pb-2">Status</th>
              <th className="text-left pr-4 pb-2">Merged in</th>
              <th className="text-left pb-2">Checks/Reviews</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-sm">
              {/* Type */}
              <td className="pr-4">
                {task.type ? (
                  <Badge variant="outline" className="text-xs">{task.type}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>

              {/* Key */}
              <td className="pr-4">
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
              </td>

              {/* Title */}
              <td className="pr-4 truncate max-w-[200px]" title={task.title}>
                {task.title}
              </td>

              {/* Repo */}
              <td className="pr-4">
                {repo ? (
                  <RepoBadge repo={repo} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>

              {/* Branch */}
              <td className="pr-4">
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
              </td>

              {/* PR */}
              <td className="pr-4">
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
              </td>

              {/* Status */}
              <td className="pr-4">
                <StatusBadge status={task.status} />
              </td>

              {/* Merged in */}
              <td className="pr-4">
                <DeploymentBadges branches={task.onDeploymentBranches} />
              </td>

              {/* Checks */}
              <td>
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
