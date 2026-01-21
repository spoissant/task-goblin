import { useParams, useNavigate } from "react-router";
import { useTaskQuery, useUpdateTask, useDeleteTask } from "@/client/lib/queries";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { useMarkLogRead } from "@/client/lib/queries/logs";
import { TaskHeader } from "@/client/components/tasks/TaskHeader";
import { TodoList } from "@/client/components/todos/TodoList";
import { BlockedByList } from "@/client/components/tasks/BlockedByList";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Badge } from "@/client/components/ui/badge";
import { ArrowLeft, RefreshCw, Trash2, ExternalLink, GitPullRequest, Check } from "lucide-react";
import { toast } from "sonner";
import type { Log } from "@/client/lib/types";

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = parseInt(id || "0", 10);

  const { data: task, isLoading, error, refetch, isFetching } = useTaskQuery(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const markLogRead = useMarkLogRead();
  const { data: settings } = useSettingsQuery();
  const { data: repos } = useRepositoriesQuery();

  const jiraHost = settings?.jira_host || undefined;
  const repoMap = new Map(repos?.items.map((r) => [r.id, r]) || []);

  const getPrUrl = (): string | undefined => {
    if (!task?.prNumber || !task?.repositoryId) return undefined;
    const repo = task.repository || repoMap.get(task.repositoryId);
    if (!repo) return undefined;
    return `https://github.com/${repo.owner}/${repo.repo}/pull/${task.prNumber}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Task not found</p>
        <Button variant="ghost" onClick={() => navigate("/")} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Tasks
        </Button>
      </div>
    );
  }

  const handleStatusChange = (status: string) => {
    updateTask.mutate(
      { id: taskId, status },
      {
        onSuccess: () => toast.success("Status updated"),
        onError: () => toast.error("Failed to update status"),
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTask.mutate(taskId, {
        onSuccess: () => {
          toast.success("Task deleted");
          navigate("/");
        },
        onError: () => toast.error("Failed to delete task"),
      });
    }
  };

  const prUrl = getPrUrl();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <TaskHeader task={task} onStatusChange={handleStatusChange} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <TodoList todos={task.todos} taskId={taskId} />
          <BlockedByList blockedBy={task.blockedBy} taskId={taskId} />
        </div>
        <div className="space-y-6">
          {/* Jira Info Section */}
          {task.jiraKey && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Jira Issue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {jiraHost ? (
                      <a
                        href={`${jiraHost.replace(/\/$/, '')}/browse/${task.jiraKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 hover:text-primary"
                      >
                        <Badge variant="outline">{task.jiraKey}</Badge>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <Badge variant="outline">{task.jiraKey}</Badge>
                    )}
                    {task.type && <Badge variant="secondary">{task.type}</Badge>}
                    {task.priority && <Badge variant="outline">{task.priority}</Badge>}
                  </div>
                  {task.assignee && (
                    <p className="text-sm text-muted-foreground">
                      Assignee: {task.assignee}
                    </p>
                  )}
                  {task.sprint && (
                    <p className="text-sm text-muted-foreground">
                      Sprint: {task.sprint}
                    </p>
                  )}
                  {task.epicKey && (
                    <p className="text-sm text-muted-foreground">
                      Epic: {task.epicKey}
                    </p>
                  )}
                  {task.jiraSyncedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last synced: {new Date(task.jiraSyncedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* PR Info Section */}
          {task.prNumber && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pull Request</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <GitPullRequest className="h-4 w-4" />
                    {prUrl ? (
                      <a
                        href={prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 hover:text-primary"
                      >
                        <Badge variant="outline">#{task.prNumber}</Badge>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <Badge variant="outline">#{task.prNumber}</Badge>
                    )}
                    {task.prState && (
                      <Badge
                        variant={
                          task.prState === "merged" ? "default" :
                          task.prState === "closed" ? "destructive" :
                          "secondary"
                        }
                      >
                        {task.prState}
                      </Badge>
                    )}
                    {task.isDraft === 1 && <Badge variant="secondary">Draft</Badge>}
                  </div>
                  {task.headBranch && (
                    <p className="text-sm text-muted-foreground font-mono">
                      {task.headBranch}
                      {task.baseBranch && ` → ${task.baseBranch}`}
                    </p>
                  )}
                  {task.prAuthor && (
                    <p className="text-sm text-muted-foreground">
                      Author: {task.prAuthor}
                    </p>
                  )}
                  {task.checksStatus && (
                    <p className="text-sm text-muted-foreground">
                      Checks: {task.checksStatus}
                    </p>
                  )}
                  {task.prSyncedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last synced: {new Date(task.prSyncedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No integrations message */}
          {!task.jiraKey && !task.prNumber && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>This is a manual task with no linked Jira issue or PR.</p>
              </CardContent>
            </Card>
          )}

          {/* Activity Logs Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {task.logs.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No activity logs</p>
              ) : (
                <div className="space-y-3">
                  {task.logs.map((log: Log) => (
                    <div
                      key={log.id}
                      className={`flex items-start justify-between gap-2 p-2 rounded ${
                        log.readAt ? "opacity-60" : "bg-muted/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {log.source}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm">{log.content}</p>
                      </div>
                      {!log.readAt && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => markLogRead.mutate(log.id)}
                          title="Mark as read"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
