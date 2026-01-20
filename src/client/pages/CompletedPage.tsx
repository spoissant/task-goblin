import { useState } from "react";
import { Link } from "react-router";
import { useCompletedTasksQuery, useRepositoriesQuery } from "@/client/lib/queries";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { StatusBadge } from "@/client/components/tasks/StatusBadge";
import { ChecksStatusCell } from "@/client/components/tasks/ChecksStatusCell";
import { Pagination } from "@/client/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { TaskWithRepository } from "@/client/lib/types";

const PAGE_SIZE = 25;

// Build Jira URL
function getJiraUrl(jiraKey: string): string {
  return `https://hivebrite.atlassian.net/browse/${jiraKey}`;
}

// Review status emoji with count
function getReviewDisplay(approvedCount: number | null): string {
  if (approvedCount === null) return "";
  if (approvedCount >= 2) return `\u2705 ${approvedCount}`;
  if (approvedCount === 1) return "\u23f3 1";
  return "\u274c 0";
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
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead className="w-[100px]">Epic</TableHead>
                  <TableHead className="w-[100px]">Key</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[120px]">Repo</TableHead>
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

  // Build GitHub PR URL if we have repo info
  const prUrl =
    repo && task.prNumber
      ? `https://github.com/${repo.owner}/${repo.repo}/pull/${task.prNumber}`
      : null;

  return (
    <TableRow>
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
          <span className="text-muted-foreground">-</span>
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
          >
            {task.epicKey}
          </a>
        ) : (
          <span className="text-muted-foreground">-</span>
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
          >
            {task.jiraKey}
          </a>
        ) : (
          <span className="text-muted-foreground">-</span>
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
      <TableCell className="text-xs text-muted-foreground">
        {repo ? repo.repo : task.repositoryId ? `#${task.repositoryId}` : "-"}
      </TableCell>

      {/* PR Number */}
      <TableCell>
        {task.prNumber ? (
          prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-blue-600 hover:underline"
            >
              #{task.prNumber}
            </a>
          ) : (
            <span className="font-mono text-xs">#{task.prNumber}</span>
          )
        ) : (
          <span className="text-muted-foreground">-</span>
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
      <TableCell>{getReviewDisplay(task.approvedReviewCount)}</TableCell>
    </TableRow>
  );
}
