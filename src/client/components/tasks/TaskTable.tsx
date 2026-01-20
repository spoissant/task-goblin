import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTasksQuery, useRepositoriesQuery, useSyncTask } from "@/client/lib/queries";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { StatusBadge } from "./StatusBadge";
import { ChecksStatusCell } from "./ChecksStatusCell";
import { ReviewStatusIcon, PrStatusIcon, UnresolvedCommentsIcon } from "./StatusIcons";
import { RepoBadge } from "./RepoBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";
import { AddTodoDialog } from "./AddTodoDialog";
import type { TaskWithNextTodo, Repository } from "@/client/lib/types";

// Status category definitions for filtering
export const STATUS_CATEGORIES: Record<string, string[]> = {
  todo: ["todo", "to do", "accepted", "backlog", "on hold"],
  in_progress: ["in_progress", "in progress"],
  code_review: ["code_review", "code review"],
  qa: ["qa", "ready for test", "ready to test"],
  done: ["done", "ready to merge", "ready to prod", "closed", "cancelled", "canceled"],
  blocked: ["blocked"],
};

function matchesCategory(status: string, category: string): boolean {
  const patterns = STATUS_CATEGORIES[category];
  if (!patterns) return false;
  const s = status.toLowerCase();
  return patterns.some((p) => s === p || s.includes(p));
}

// Build Jira URL
function getJiraUrl(jiraKey: string, jiraHost?: string): string {
  const host = jiraHost || "hivebrite.atlassian.net";
  return `https://${host}/browse/${jiraKey}`;
}

interface TaskTableProps {
  statusFilter?: string;
}

export function TaskTable({ statusFilter }: TaskTableProps) {
  // Fetch all tasks (no server-side status filter for category-based filtering)
  const { data, isLoading, error } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const [addTodoTask, setAddTodoTask] = useState<{ id: number; title: string } | null>(null);

  // Build a map of repositoryId -> Repository for quick lookups
  const repoMap = useMemo(() => {
    const map = new Map<number, Repository>();
    if (reposData?.items) {
      for (const repo of reposData.items) {
        map.set(repo.id, repo);
      }
    }
    return map;
  }, [reposData?.items]);

  // Client-side filtering by category
  const filteredTasks = useMemo(() => {
    if (!data?.items) return [];
    if (!statusFilter) return data.items;
    return data.items.filter((task) => matchesCategory(task.status, statusFilter));
  }, [data?.items, statusFilter]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load tasks
      </div>
    );
  }

  if (!filteredTasks.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No tasks found
      </div>
    );
  }

  return (
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
            <TableHead className="w-[100px]">Merged in</TableHead>
            <TableHead className="w-[60px]">PR</TableHead>
            <TableHead className="w-[50px]">Checks</TableHead>
            <TableHead className="w-[60px]">Reviews</TableHead>
            <TableHead className="w-[60px]">Comments</TableHead>
            <TableHead className="w-[200px]">Next Todo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              repo={task.repositoryId ? repoMap.get(task.repositoryId) : undefined}
              onAddTodo={() => setAddTodoTask({ id: task.id, title: task.title })}
            />
          ))}
        </TableBody>
      </Table>
      {addTodoTask && (
        <AddTodoDialog
          open={!!addTodoTask}
          onOpenChange={(open) => !open && setAddTodoTask(null)}
          taskId={addTodoTask.id}
          taskTitle={addTodoTask.title}
        />
      )}
    </TooltipProvider>
  );
}

interface DeploymentBadgesProps {
  branches: string | null;
}

function DeploymentBadges({ branches }: DeploymentBadgesProps) {
  if (!branches) return <span className="text-muted-foreground">—</span>;

  try {
    const parsed: string[] = JSON.parse(branches);
    if (!parsed.length) return <span className="text-muted-foreground">—</span>;

    return (
      <div className="flex flex-wrap gap-1">
        {parsed.map((branch) => (
          <Badge key={branch} variant="secondary" className="text-xs">
            {branch}
          </Badge>
        ))}
      </div>
    );
  } catch {
    return <span className="text-muted-foreground">—</span>;
  }
}

interface TaskRowProps {
  task: TaskWithNextTodo;
  repo?: Repository;
  onAddTodo: () => void;
}

function TaskRow({ task, repo, onAddTodo }: TaskRowProps) {
  const syncTask = useSyncTask();

  // Build GitHub PR URL if we have repo info
  const prUrl = repo && task.prNumber
    ? `https://github.com/${repo.owner}/${repo.repo}/pull/${task.prNumber}`
    : null;

  // Only show sync if task has Jira or PR
  const canSync = task.jiraKey || task.prNumber;

  const handleSync = (e: React.MouseEvent) => {
    e.stopPropagation();
    syncTask.mutate({ task, repo });
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
          <Badge variant="outline" className="text-xs">{task.type}</Badge>
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

      {/* Merged in */}
      <TableCell>
        <DeploymentBadges branches={task.onDeploymentBranches} />
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
        <ChecksStatusCell checksStatus={task.checksStatus} checksDetails={task.checksDetails} />
      </TableCell>

      {/* Review */}
      <TableCell>
        <ReviewStatusIcon approvedCount={task.approvedReviewCount} />
      </TableCell>

      {/* Comments */}
      <TableCell>
        <UnresolvedCommentsIcon count={task.unresolvedCommentCount} />
      </TableCell>

      {/* Next Todo */}
      <TableCell className="max-w-[200px]">
        <div className="flex items-center gap-1">
          {task.nextTodo ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm truncate flex-1 cursor-default">
                  {task.nextTodo.content}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" collisionPadding={16} className="max-w-[300px]">
                {task.nextTodo.content}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground flex-1">—</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onAddTodo();
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
