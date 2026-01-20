import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { StatusBadge } from "@/client/components/tasks/StatusBadge";
import { ExternalLink, GitPullRequest, Scissors, MessageSquare } from "lucide-react";
import { useSplitTask } from "@/client/lib/queries";
import { toast } from "sonner";
import type { TaskWithRepository } from "@/client/lib/types";
import { isMergedTask } from "@/client/lib/types";

interface Props {
  task: TaskWithRepository;
  jiraHost?: string;
  getPrUrl: (task: TaskWithRepository) => string | undefined;
}

export function TaskRow({ task, jiraHost, getPrUrl }: Props) {
  const splitTask = useSplitTask();
  const prUrl = getPrUrl(task);

  const handleSplit = () => {
    if (confirm("Split this task back into separate Jira and PR orphans?")) {
      splitTask.mutate(task.id, {
        onSuccess: () => toast.success("Task split into Jira and PR orphans"),
        onError: () => toast.error("Failed to split task"),
      });
    }
  };

  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 p-3 border rounded-lg bg-card">
      {/* Task Info */}
      <div className="flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-2">
          {task.jiraKey && jiraHost && (
            <a
              href={`${jiraHost.replace(/\/$/, '')}/browse/${task.jiraKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-primary"
            >
              <Badge variant="outline">{task.jiraKey}</Badge>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          )}
          {task.jiraKey && !jiraHost && (
            <Badge variant="outline">{task.jiraKey}</Badge>
          )}
          {task.prNumber && prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-primary"
            >
              <GitPullRequest className="h-3 w-3" />
              <Badge variant="secondary">#{task.prNumber}</Badge>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          )}
          {task.prNumber && !prUrl && (
            <div className="flex items-center gap-1">
              <GitPullRequest className="h-3 w-3" />
              <Badge variant="secondary">#{task.prNumber}</Badge>
            </div>
          )}
          {task.unresolvedCommentCount && task.unresolvedCommentCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <MessageSquare className="h-3 w-3" />
              {task.unresolvedCommentCount}
            </Badge>
          )}
        </div>
        <p className="font-medium truncate mt-1">{task.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <StatusBadge status={task.status} className="text-xs" />
          {task.type && (
            <Badge variant="outline" className="text-xs">{task.type}</Badge>
          )}
          {task.isDraft === 1 && (
            <Badge variant="secondary" className="text-xs">Draft</Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isMergedTask(task) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSplit}
            title="Split into separate Jira and PR orphans"
          >
            <Scissors className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
