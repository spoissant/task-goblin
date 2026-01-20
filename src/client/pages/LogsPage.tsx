import { useState } from "react";
import { Link } from "react-router";
import {
  useLogsQuery,
  useUnreadCountQuery,
  useMarkLogRead,
  useMarkAllLogsRead,
  useJiraConfigQuery,
} from "@/client/lib/queries";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Pagination } from "@/client/components/ui/pagination";
import {
  Card,
  CardHeader,
  CardContent,
  CardAction,
} from "@/client/components/ui/card";
import type { Log } from "@/client/lib/types";
import { CheckCircle, ExternalLink } from "lucide-react";

const PAGE_SIZE = 25;

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

export function LogsPage() {
  const [page, setPage] = useState(0);
  const [showRead, setShowRead] = useState(false);

  const { data, isLoading, error } = useLogsQuery({
    includeRead: showRead,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const { data: unreadData } = useUnreadCountQuery();
  const { data: jiraConfig } = useJiraConfigQuery();
  const markRead = useMarkLogRead();
  const markAllRead = useMarkAllLogsRead();

  const unreadCount = unreadData?.count ?? 0;
  const jiraHost = jiraConfig?.jira_host;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const handleMarkAllRead = () => {
    markAllRead.mutate();
  };

  // Reset page when toggling show read
  const handleToggleShowRead = () => {
    setShowRead(!showRead);
    setPage(0);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Logs</h1>
          {unreadCount > 0 && (
            <Badge variant="destructive">{unreadCount} unread</Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={showRead}
              onCheckedChange={handleToggleShowRead}
            />
            Show read logs
          </label>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark all as read
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-muted-foreground">
          Failed to load logs
        </div>
      )}

      {data && !data.items.length && (
        <div className="text-center py-12 text-muted-foreground">
          {showRead ? "No logs found" : "No unread logs"}
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="space-y-4">
            {data.items.map((log) => (
              <LogCard
                key={log.id}
                log={log}
                jiraHost={jiraHost}
                onMarkRead={() => markRead.mutate(log.id)}
                isMarkingRead={markRead.isPending}
              />
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            className="mt-6"
          />
        </>
      )}
    </div>
  );
}

interface LogCardProps {
  log: Log;
  jiraHost?: string | null;
  onMarkRead: () => void;
  isMarkingRead: boolean;
}

function LogCard({ log, jiraHost, onMarkRead, isMarkingRead }: LogCardProps) {
  const isRead = log.readAt !== null;
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
    <Card className={isRead ? "opacity-60" : ""}>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Badge variant={getSourceVariant(log.source)}>{log.source}</Badge>
            <span className="text-sm text-muted-foreground">
              {formatTimestamp(log.createdAt)}
            </span>
            {isRead && (
              <span className="text-xs text-muted-foreground">
                (Read {formatTimestamp(log.readAt!)})
              </span>
            )}
          </div>
          {task && (
            <div className="flex items-center gap-2 text-sm">
              {jiraUrl ? (
                <a
                  href={jiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline flex items-center gap-1"
                >
                  {task.jiraKey}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : task.jiraKey ? (
                <span className="text-muted-foreground">{task.jiraKey}</span>
              ) : null}
              {task.jiraKey && prUrl && (
                <span className="text-muted-foreground">·</span>
              )}
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
              {(task.jiraKey || prUrl) && (
                <span className="text-muted-foreground">·</span>
              )}
              <Link
                to={`/tasks/${task.id}`}
                className="text-foreground hover:underline truncate"
              >
                {task.title}
              </Link>
            </div>
          )}
        </div>
        {!isRead && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkRead}
              disabled={isMarkingRead}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Mark as read
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap font-sans text-sm">{log.content}</pre>
      </CardContent>
    </Card>
  );
}
