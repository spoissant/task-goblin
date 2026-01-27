import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Badge } from "@/client/components/ui/badge";
import { CheckCircle, XCircle, SkipForward } from "lucide-react";
import type { BulkDeployResult, TaskWithTodos } from "@/client/lib/types";

interface BulkDeployResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: BulkDeployResult | null;
  taskMap: Map<number, TaskWithTodos>;
}

export function BulkDeployResultsDialog({
  open,
  onOpenChange,
  results,
  taskMap,
}: BulkDeployResultsDialogProps) {
  if (!results) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deploy Results</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex gap-4 text-sm">
            {results.summary.success > 0 && (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="h-3 w-3" />
                {results.summary.success} deployed
              </Badge>
            )}
            {results.summary.conflict > 0 && (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" />
                {results.summary.conflict} conflict
              </Badge>
            )}
            {results.summary.skipped > 0 && (
              <Badge variant="secondary" className="gap-1">
                <SkipForward className="h-3 w-3" />
                {results.summary.skipped} skipped
              </Badge>
            )}
          </div>

          {/* Per-task results */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {results.results.map((result) => {
              const task = taskMap.get(result.taskId);
              return (
                <div
                  key={result.taskId}
                  className={`p-3 rounded border ${
                    result.status === "success"
                      ? "bg-green-50 border-green-200"
                      : result.status === "conflict"
                        ? "bg-red-50 border-red-200"
                        : "bg-muted border-muted-foreground/20"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {result.status === "success" && (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                    {result.status === "conflict" && (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    {result.status === "skipped" && (
                      <SkipForward className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-sm truncate text-gray-900">
                      {task?.jiraKey || task?.title || `Task #${result.taskId}`}
                    </span>
                  </div>
                  {result.status === "success" && result.commitSha && (
                    <p className="text-xs text-muted-foreground font-mono ml-6">
                      {result.commitSha.substring(0, 7)}
                    </p>
                  )}
                  {result.status === "conflict" && result.conflictedFiles && (
                    <div className="ml-6 mt-1">
                      <p className="text-xs text-muted-foreground mb-1">
                        Conflicted files:
                      </p>
                      <ul className="space-y-0.5">
                        {result.conflictedFiles.map((file) => (
                          <li
                            key={file}
                            className="text-xs font-mono text-red-700 bg-red-100 px-1 py-0.5 rounded"
                          >
                            {file}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.status === "skipped" && result.reason && (
                    <p className="text-xs text-muted-foreground ml-6">
                      {result.reason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
