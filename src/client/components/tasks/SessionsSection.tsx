import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/client/lib/api";
import { useTaskSessionsQuery } from "@/client/lib/queries/sessions";
import { useRemoveTaskWorktree, useTaskWorktreeQuery } from "@/client/lib/queries/worktrees";
import type { ClaudeSessionState } from "@/client/lib/types";
import { Button } from "@/client/components/ui/button";
import { CopyChip } from "@/client/components/ui/copy-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { cn } from "@/client/lib/utils";

const STATE_CLASS: Record<ClaudeSessionState, string> = {
  queued: "text-muted-foreground",
  preparing: "text-muted-foreground",
  working: "text-blue-500",
  blocked: "text-yellow-600",
  done: "text-green-600",
  failed: "text-red-500",
  stopped: "text-muted-foreground",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

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

      {items.length > 0 && (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chore</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Started</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">{s.choreName}</TableCell>
                  <TableCell className={cn("text-sm font-medium", STATE_CLASS[s.state])}>{s.state}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate" title={s.needs ?? s.detail ?? s.error ?? ""}>
                    {s.needs ?? s.detail ?? s.error ?? s.result ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(s.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      {s.link && (
                        <a
                          href={s.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs"
                        >
                          <ExternalLink className="h-3 w-3" />
                          claude.ai
                        </a>
                      )}
                      {s.shortId && <CopyChip value={`claude attach ${s.shortId}`}>attach {s.shortId}</CopyChip>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
