import { RefreshCw } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { useSyncTask } from "@/client/lib/queries";
import type { Task, Repository } from "@/client/lib/types";

// Re-sync the task from Jira and GitHub; only shown when it has either.
export function SyncCell({ task, repo }: { task: Task; repo?: Repository }) {
  const syncTask = useSyncTask();
  if (!task.jiraKey && !task.prNumber) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => syncTask.mutate({ task, repo })}
      disabled={syncTask.isPending}
    >
      <RefreshCw className={`h-4 w-4 ${syncTask.isPending ? "animate-spin" : ""}`} />
    </Button>
  );
}
