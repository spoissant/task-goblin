import { useTaskLogsQuery, useMarkTaskLogsRead, useJiraConfigQuery } from "@/client/lib/queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import { CheckCircle, ExternalLink } from "lucide-react";
import type { Log } from "@/client/lib/types";

interface TaskLogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  taskTitle: string;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function getSourceVariant(source: string): "default" | "secondary" | "outline" {
  switch (source.toLowerCase()) {
    case "jira":
      return "default";
    case "github":
      return "secondary";
    default:
      return "outline";
  }
}

export function TaskLogsModal({
  open,
  onOpenChange,
  taskId,
  taskTitle,
}: TaskLogsModalProps) {
  const { data, isLoading } = useTaskLogsQuery(open ? taskId : null);
  const { data: jiraConfig } = useJiraConfigQuery();
  const markRead = useMarkTaskLogsRead();

  const jiraHost = jiraConfig?.jira_host;
  const logCount = data?.items?.length ?? 0;

  const handleMarkAllRead = () => {
    markRead.mutate(taskId, {
      onSuccess: () => {
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Task Logs</DialogTitle>
          <p className="text-sm text-muted-foreground truncate" title={taskTitle}>
            {taskTitle}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !data?.items?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No logs for this task
            </div>
          ) : (
            data.items.map((log) => (
              <LogCard key={log.id} log={log} jiraHost={jiraHost} />
            ))
          )}
        </div>

        {logCount > 0 && (
          <DialogFooter className="border-t pt-4">
            <Button
              onClick={handleMarkAllRead}
              disabled={markRead.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark {logCount} as Read
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface LogCardProps {
  log: Log;
  jiraHost?: string | null;
}

function LogCard({ log, jiraHost }: LogCardProps) {
  const task = log.task;

  const jiraUrl =
    task?.jiraKey && jiraHost
      ? `https://${jiraHost}/browse/${task.jiraKey}`
      : null;

  const prUrl =
    task?.prNumber && task.repository
      ? `https://github.com/${task.repository.owner}/${task.repository.repo}/pull/${task.prNumber}`
      : null;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={getSourceVariant(log.source)} className="text-xs">
          {log.source}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(log.createdAt)}
        </span>
      </div>
      {task && (jiraUrl || prUrl) && (
        <div className="flex items-center gap-2 text-xs mb-2">
          {jiraUrl && (
            <a
              href={jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1"
            >
              {task.jiraKey}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {jiraUrl && prUrl && <span className="text-muted-foreground">|</span>}
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1"
            >
              #{task.prNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
      <pre className="whitespace-pre-wrap font-sans text-sm">{log.content}</pre>
    </div>
  );
}
