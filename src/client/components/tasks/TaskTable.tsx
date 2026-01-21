import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTasksQuery, useRepositoriesQuery, useSyncTask } from "@/client/lib/queries";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/client/components/ui/tooltip";
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
import { RefreshCw, ListTodo, MessageSquare, Bell } from "lucide-react";
import { toast } from "sonner";
import { TodosDialog } from "./TodosDialog";
import { TaskLogsModal } from "./TaskLogsModal";
import type { TaskWithTodos, Repository } from "@/client/lib/types";

// Status category definitions for filtering
export const STATUS_CATEGORIES: Record<string, string[]> = {
  ready_to_merge: ["ready to merge", "ready to prod"],
  qa: ["qa", "ready for test", "ready to test"],
  code_review: ["code_review", "code review"],
  in_progress: ["in_progress", "in progress"],
  todo: ["todo", "to do", "accepted", "backlog", "on hold", "done", "closed", "cancelled", "canceled", "blocked"],
};

function matchesCategory(status: string, category: string): boolean {
  const patterns = STATUS_CATEGORIES[category];
  if (!patterns) return false;
  const s = status.toLowerCase();
  return patterns.some((p) => s === p || s.includes(p));
}

// Build Jira URL - requires jiraHost, returns null if not configured
function getJiraUrl(jiraKey: string, jiraHost: string | undefined | null): string | null {
  if (!jiraHost) return null;
  return `https://${jiraHost}/browse/${jiraKey}`;
}

interface TaskTableProps {
  statusFilter?: string;
}

export function TaskTable({ statusFilter }: TaskTableProps) {
  // Fetch all tasks (no server-side status filter for category-based filtering)
  const { data, isLoading, error } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const { data: settingsData } = useSettingsQuery();
  const [todoDialogTask, setTodoDialogTask] = useState<{ id: number; title: string } | null>(null);
  const [logsModalTask, setLogsModalTask] = useState<{ id: number; title: string } | null>(null);

  // Extract jiraHost from settings
  const jiraHost = settingsData?.jira_host || null;

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
            <TableHead className="w-[80px]">Type</TableHead>
            <TableHead className="w-[140px]">Sprint</TableHead>
            <TableHead className="w-[100px]">Epic</TableHead>
            <TableHead className="w-[100px]">Key</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-[120px]">Repo</TableHead>
            <TableHead className="w-[150px]">Branch</TableHead>
            <TableHead className="w-[60px]">PR</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[100px]">Merged in</TableHead>
            <TableHead className="w-[50px]">Checks</TableHead>
            <TableHead className="w-[60px]">Reviews</TableHead>
            <TableHead className="w-[50px]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <MessageSquare className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>Pull Request Comments</TooltipContent>
              </Tooltip>
            </TableHead>
            <TableHead className="w-[80px]">Todos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              repo={task.repositoryId ? repoMap.get(task.repositoryId) : undefined}
              jiraHost={jiraHost}
              onOpenTodos={() => setTodoDialogTask({ id: task.id, title: task.title })}
              onOpenLogs={() => setLogsModalTask({ id: task.id, title: task.title })}
            />
          ))}
        </TableBody>
      </Table>
      {todoDialogTask && (
        <TodosDialog
          open={!!todoDialogTask}
          onOpenChange={(open) => !open && setTodoDialogTask(null)}
          taskId={todoDialogTask.id}
          taskTitle={todoDialogTask.title}
        />
      )}
      {logsModalTask && (
        <TaskLogsModal
          open={!!logsModalTask}
          onOpenChange={(open) => !open && setLogsModalTask(null)}
          taskId={logsModalTask.id}
          taskTitle={logsModalTask.title}
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
  task: TaskWithTodos;
  repo?: Repository;
  jiraHost: string | null;
  onOpenTodos: () => void;
  onOpenLogs: () => void;
}

function TaskRow({ task, repo, jiraHost, onOpenTodos, onOpenLogs }: TaskRowProps) {
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

  const handleOpenLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenLogs();
  };

  return (
    <TableRow>
      {/* Sync / Unread Logs */}
      <TableCell>
        {task.unreadLogCount > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleOpenLogs}
                className="relative inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted"
              >
                <Bell className="h-4 w-4 text-orange-500" />
                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full h-4 min-w-[1rem] px-1 flex items-center justify-center font-medium">
                  {task.unreadLogCount}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{task.unreadLogCount} unread log(s)</TooltipContent>
          </Tooltip>
        ) : canSync ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleSync}
            disabled={syncTask.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${syncTask.isPending ? "animate-spin" : ""}`} />
          </Button>
        ) : null}
      </TableCell>

      {/* Type */}
      <TableCell>
        {task.type ? (
          <Badge variant="outline" className="text-xs">{task.type}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Sprint */}
      <TableCell className="max-w-[140px] truncate text-xs" title={task.sprint || undefined}>
        {task.sprint || <span className="text-muted-foreground">—</span>}
      </TableCell>

      {/* Epic */}
      <TableCell>
        {task.epicKey ? (
          (() => {
            const epicUrl = getJiraUrl(task.epicKey, jiraHost);
            return epicUrl ? (
              <a
                href={epicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-mono text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                {task.epicKey}
              </a>
            ) : (
              <span className="font-mono text-xs">{task.epicKey}</span>
            );
          })()
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Jira Key */}
      <TableCell>
        {task.jiraKey ? (
          (() => {
            const jiraUrl = getJiraUrl(task.jiraKey, jiraHost);
            return jiraUrl ? (
              <a
                href={jiraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-mono text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                {task.jiraKey}
              </a>
            ) : (
              <span className="font-mono text-xs">{task.jiraKey}</span>
            );
          })()
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

      {/* Status */}
      <TableCell>
        <StatusBadge status={task.status} />
      </TableCell>

      {/* Merged in */}
      <TableCell>
        <DeploymentBadges branches={task.onDeploymentBranches} />
      </TableCell>

      {/* Checks */}
      <TableCell>
        <ChecksStatusCell checksStatus={task.checksStatus} checksDetails={task.checksDetails} prUrl={prUrl} />
      </TableCell>

      {/* Review */}
      <TableCell>
        <ReviewStatusIcon approvedCount={task.approvedReviewCount} prUrl={prUrl} />
      </TableCell>

      {/* Comments */}
      <TableCell>
        <UnresolvedCommentsIcon count={task.unresolvedCommentCount} prUrl={prUrl} />
      </TableCell>

      {/* Todos */}
      <TableCell>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenTodos();
          }}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 ${
            task.pendingTodos.length > 0
              ? "bg-yellow-100 text-yellow-800"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <ListTodo className="h-3.5 w-3.5" />
          {task.pendingTodos.length}
        </button>
      </TableCell>
    </TableRow>
  );
}
