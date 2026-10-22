import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useSyncTask } from "@/client/lib/queries/sync";
import type { Task } from "@/shared/types";

// Re-sync the task from Jira, GitHub and its worktree; only shown when it has Jira or a PR.
export function SyncCell({ task }: { task: Task }) {
  const syncTask = useSyncTask();
  if (!task.jiraKey && !task.prNumber) return null;

  const sync = () =>
    syncTask.mutate(task.id, {
      onSuccess: ({ errors }) => errors.forEach((error) => toast.error(error)),
      onError: (err) => toast.error(err.message),
    });

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={sync}
      disabled={syncTask.isPending}
    >
      <RefreshCw className={`h-4 w-4 ${syncTask.isPending ? "animate-spin" : ""}`} />
    </Button>
  );
}
