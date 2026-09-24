import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/client/lib/api";
import { useTaskSessionsQuery } from "@/client/lib/queries/sessions";
import { useRemoveTaskWorktree, useTaskWorktreeQuery } from "@/client/lib/queries/worktrees";
import { Button } from "@/client/components/ui/button";
import { CopyChip } from "@/client/components/ui/copy-chip";
import { SessionsTable } from "./SessionsTable";
import { cn } from "@/client/lib/utils";

/** Worktree status and the history of AI sessions for a task. */
export function SessionsSection({ taskId }: { taskId: number }) {
  const { data: worktree } = useTaskWorktreeQuery(taskId);
  const { data: sessions } = useTaskSessionsQuery(taskId);
  const removeWorktree = useRemoveTaskWorktree();

  const remove = (force = false) => {
    removeWorktree.mutate(
      { taskId, force },
      {
        onSuccess: () => toast.success("Removing worktree"),
        onError: (err) => {
          if (err instanceof ApiError && err.code === "WORKTREE_DIRTY") {
            if (confirm(`${err.message}. Remove anyway and lose those changes?`)) remove(true);
            return;
          }
          toast.error(err instanceof Error ? err.message : "Failed to remove worktree");
        },
      },
    );
  };

  const items = sessions?.items ?? [];
  if (!worktree && items.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Sessions</p>

      {worktree && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Worktree</span>
          <CopyChip value={worktree.path} message="Path copied">{worktree.path}</CopyChip>
          <span className="font-mono text-xs text-muted-foreground">{worktree.branch ?? "detached"}</span>
          <span
            className={cn(
              "text-xs font-medium inline-flex items-center gap-1",
              worktree.state === "ready" ? "text-green-600" : worktree.state === "failed" ? "text-red-500" : "text-muted-foreground",
            )}
          >
            {(worktree.state === "preparing" || worktree.state === "removing") && <Loader2 className="h-3 w-3 animate-spin" />}
            {worktree.state}
            {worktree.changedFiles !== null && worktree.changedFiles > 0 && ` · ${worktree.changedFiles} changed`}
          </span>
          {worktree.error && <span className="text-xs text-red-500 truncate max-w-md" title={worktree.error}>{worktree.error}</span>}
          {(worktree.state === "ready" || worktree.state === "failed" || worktree.state === "dirty") && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => remove(false)}
              disabled={removeWorktree.isPending}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Remove
            </Button>
          )}
        </div>
      )}

      {items.length > 0 && <SessionsTable sessions={items} />}
    </div>
  );
}
