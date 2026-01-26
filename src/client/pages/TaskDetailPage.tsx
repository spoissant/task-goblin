import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useTaskQuery, useUpdateTask, useDeleteTask, useCurrentTodo } from "@/client/lib/queries";
import { cn } from "@/client/lib/utils";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { useMarkLogRead } from "@/client/lib/queries/logs";
import { useDeployBranch } from "@/client/lib/queries/deploy";
import { useSyncTask } from "@/client/lib/queries/sync";
import { TaskHeader } from "@/client/components/tasks/TaskHeader";
import { TaskNotes } from "@/client/components/tasks/TaskNotes";
import { TaskInstructions } from "@/client/components/tasks/TaskInstructions";
import { TaskSummaryBar } from "@/client/components/tasks/TaskSummaryBar";
import { TodoList } from "@/client/components/todos/TodoList";
import { BlockedByList } from "@/client/components/tasks/BlockedByList";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Badge } from "@/client/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { ArrowLeft, RefreshCw, Trash2, ExternalLink, GitPullRequest, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Log } from "@/client/lib/types";

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = parseInt(id || "0", 10);

  const { data: task, isLoading, error } = useTaskQuery(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const markLogRead = useMarkLogRead();
  const deployBranch = useDeployBranch();
  const syncTask = useSyncTask();
  const { data: settings } = useSettingsQuery();
  const { data: repos } = useRepositoriesQuery();
  const { currentTodo } = useCurrentTodo();

  const isActiveTodoTask = currentTodo?.taskId === taskId;

  const [deployTargetBranch, setDeployTargetBranch] = useState<string>("");
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictedFiles, setConflictedFiles] = useState<string[]>([]);

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

  // Get deployment branches from repository
  const repo = task?.repository || (task?.repositoryId ? repoMap.get(task.repositoryId) : undefined);
  const deploymentBranches: string[] = repo?.deploymentBranches
    ? JSON.parse(repo.deploymentBranches)
    : [];
  const canDeploy = task?.headBranch && repo?.localPath && deploymentBranches.length > 0;

  const handleDeploy = () => {
    if (!deployTargetBranch) {
      toast.error("Please select a target branch");
      return;
    }

    deployBranch.mutate(
      { taskId, targetBranch: deployTargetBranch },
      {
        onSuccess: (result) => {
          if (result.success) {
            toast.success(`Deployed to ${deployTargetBranch}`);
          } else if (result.conflict) {
            setConflictedFiles(result.conflictedFiles);
            setConflictDialogOpen(true);
          }
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Deploy failed");
        },
      }
    );
  };

  return (
    <div className={cn("space-y-8", isActiveTodoTask && "bg-lime-50 dark:bg-lime-700/40 -m-6 p-6")}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncTask.mutate({ task, repo })}
            disabled={syncTask.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${syncTask.isPending ? "animate-spin" : ""}`} />
            Sync
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Summary Bar */}
      {(task.jiraKey || task.prNumber) && (
        <TaskSummaryBar task={task} repo={repo} jiraHost={jiraHost} />
      )}

      {/* Jira and PR cards side by side */}
      {(task.jiraKey || task.prNumber) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                      <button
                        type="button"
                        className="hover:text-blue-600 cursor-pointer"
                        onClick={() => {
                          navigator.clipboard.writeText(task.headBranch!);
                          toast.success("Branch copied to clipboard");
                        }}
                      >
                        {task.headBranch}
                      </button>
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
                  {canDeploy && (
                    <div className="pt-3 mt-3 border-t">
                      <p className="text-sm font-medium mb-2">Deploy to Environment</p>
                      <div className="flex items-center gap-2">
                        <Select
                          value={deployTargetBranch}
                          onValueChange={setDeployTargetBranch}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {deploymentBranches.map((branch) => (
                              <SelectItem key={branch} value={branch}>
                                {branch}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          onClick={handleDeploy}
                          disabled={!deployTargetBranch || deployBranch.isPending}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {deployBranch.isPending ? "Deploying..." : "Deploy"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <TaskHeader task={task} onStatusChange={handleStatusChange} />

      <TaskNotes task={task} />
      <TaskInstructions task={task} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <TodoList todos={task.todos} taskId={taskId} />
          <BlockedByList blockedBy={task.blockedBy} taskId={taskId} />
        </div>
        <div className="space-y-6">
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

      {/* Merge Conflict Dialog */}
      <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Conflict</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Could not deploy due to merge conflicts in the following files:
            </p>
            <ul className="space-y-1">
              {conflictedFiles.map((file) => (
                <li key={file} className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {file}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Please resolve the conflicts locally and try again.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
