import { Link, useParams, useNavigate } from "react-router";
import { useTaskQuery, useDeleteTask } from "@/client/lib/queries";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { useSyncTask } from "@/client/lib/queries/sync";
import { TaskHeader } from "@/client/components/tasks/TaskHeader";
import { TaskSummaryBar } from "@/client/components/tasks/TaskSummaryBar";
import { ChoreSkipsEditor } from "@/client/components/tasks/ChoreSkipsEditor";
import { SessionsSection } from "@/client/components/tasks/SessionsSection";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = parseInt(id || "0", 10);

  const { data: task, isLoading, error } = useTaskQuery(taskId);
  const deleteTask = useDeleteTask();
  const syncTask = useSyncTask();
  const { data: settings } = useSettingsQuery();
  const jiraHost = settings?.jira_host || undefined;

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
        <Button variant="ghost" asChild className="mt-4">
          <Link to="/tasks">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tasks
          </Link>
        </Button>
      </div>
    );
  }

  const handleSync = () => {
    syncTask.mutate(taskId, {
      onSuccess: ({ errors }) => errors.forEach((message) => toast.error(message)),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTask.mutate(taskId, {
        onSuccess: () => {
          toast.success("Task deleted");
          navigate("/tasks");
        },
        onError: () => toast.error("Failed to delete task"),
      });
    }
  };

  // Jira and PR tasks get the summary bar, which carries the status picker.
  const hasSummary = !!(task.jiraKey || task.prNumber);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/tasks">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncTask.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncTask.isPending ? "animate-spin" : ""}`} />
            Sync
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {hasSummary && <TaskSummaryBar task={task} jiraHost={jiraHost} />}

      {/* Goblin Chore Skips — only for tasks with PRs */}
      {task.prNumber && (
        <ChoreSkipsEditor taskId={taskId} choreSkips={task.choreSkips ?? null} />
      )}

      <SessionsSection task={task} />

      <TaskHeader task={task} showStatus={!hasSummary} />
    </div>
  );
}
