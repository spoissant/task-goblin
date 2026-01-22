import { useState } from "react";
import { Link } from "react-router";
import { useCompletedTasksQuery, useSyncTask } from "@/client/lib/queries";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { StatusBadge } from "@/client/components/tasks/StatusBadge";
import { ChecksStatusCell } from "@/client/components/tasks/ChecksStatusCell";
import { ReviewStatusIcon, PrStatusIcon } from "@/client/components/tasks/StatusIcons";
import { RepoBadge } from "@/client/components/tasks/RepoBadge";
import { Pagination } from "@/client/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { TaskWithRepository } from "@/client/lib/types";

const PAGE_SIZE = 25;

// Build Jira URL
function getJiraUrl(jiraKey: string): string {
  return `https://hivebrite.atlassian.net/browse/${jiraKey}`;
}

export function CompletedPage() {
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useCompletedTasksQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Completed Tasks</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.total} completed task{data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-6 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-amber-800 dark:text-amber-200 text-sm">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>
          Completed issues are NOT synced during the "Sync all" action. Use the sync button on individual rows if you need the latest state.
        </span>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-muted-foreground">
          Failed to load completed tasks
        </div>
      )}

      {data && !data.items.length && (
        <div className="text-center py-12 text-muted-foreground">
          No completed tasks found
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead className="w-[100px]">Epic</TableHead>
                  <TableHead className="w-[100px]">Key</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[120px]">Repo</TableHead>
                  <TableHead className="w-[150px]">Branch</TableHead>
                  <TableHead className="w-[60px]">PR</TableHead>
                  <TableHead className="w-[50px]">Checks</TableHead>
                  <TableHead className="w-[60px]">Reviews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((task) => (
                  <CompletedTaskRow key={task.id} task={task} />
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>

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

interface CompletedTaskRowProps {
  task: TaskWithRepository;
}

function CompletedTaskRow({ task }: CompletedTaskRowProps) {
  const repo = task.repository;
  const syncTask = useSyncTask();

  // Build GitHub PR URL if we have repo info
  const prUrl =
    repo && task.prNumber
      ? `https://github.com/${repo.owner}/${repo.repo}/pull/${task.prNumber}`
      : null;

  // Only show sync if task has Jira or PR
  const canSync = task.jiraKey || task.prNumber;

  const handleSync = (e: React.MouseEvent) => {
    e.stopPropagation();
    syncTask.mutate({ task, repo: repo ?? undefined });
  };

  return (
    <TableRow>
      {/* Sync */}
      <TableCell>
        {canSync && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleSync}
            disabled={syncTask.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${syncTask.isPending ? "animate-spin" : ""}`} />
          </Button>
        )}
      </TableCell>

      {/* Status */}
      <TableCell>
        <StatusBadge status={task.status} />
      </TableCell>

      {/* Type */}
      <TableCell>
        {task.type ? (
          <Badge variant="outline" className="text-xs">
            {task.type}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Epic */}
      <TableCell>
        {task.epicKey ? (
          <a
            href={getJiraUrl(task.epicKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline font-mono text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {task.epicKey}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Jira Key */}
      <TableCell>
        {task.jiraKey ? (
          <a
            href={getJiraUrl(task.jiraKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline font-mono text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {task.jiraKey}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Title */}
      <TableCell className="max-w-[300px]">
        <Link
          to={`/tasks/${task.id}`}
          className="hover:underline truncate block"
          title={task.title}
        >
          {task.title}
        </Link>
      </TableCell>

      {/* Repository */}
      <TableCell>
        {repo ? (
          <RepoBadge repo={repo} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Branch */}
      <TableCell className="font-mono text-xs max-w-[150px] truncate" title={task.headBranch || undefined}>
        {task.headBranch ? (
          <button
            type="button"
            className="hover:text-blue-600 cursor-pointer text-left"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(task.headBranch!);
              toast.success("Branch copied to clipboard");
            }}
          >
            {task.headBranch}
          </button>
        ) : (
          "—"
        )}
      </TableCell>

      {/* PR Number */}
      <TableCell>
        {task.prNumber ? (
          prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
              <span>#{task.prNumber}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
              <span>#{task.prNumber}</span>
            </span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Checks */}
      <TableCell>
        <ChecksStatusCell
          checksStatus={task.checksStatus}
          checksDetails={task.checksDetails}
        />
      </TableCell>

      {/* Review */}
      <TableCell>
        <ReviewStatusIcon approvedCount={task.approvedReviewCount} />
      </TableCell>
    </TableRow>
  );
}
