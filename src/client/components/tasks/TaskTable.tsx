import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTasksQuery, useRepositoriesQuery, useSyncTask, useCurrentTodo } from "@/client/lib/queries";
import { useSettingsQuery, useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
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
import { TodosDialog } from "./TodosDialog";
import { TaskLogsModal } from "./TaskLogsModal";
import { toast } from "sonner";
import type { TaskWithTodos, Repository } from "@/client/lib/types";

// Normalize status name for comparison (case-insensitive, handles underscore/space variants)
function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

// Build Jira URL - requires jiraHost, returns null if not configured
function getJiraUrl(jiraKey: string, jiraHost: string | undefined | null): string | null {
  if (!jiraHost) return null;
  // Strip protocol and trailing slashes from jiraHost if present
  const cleanHost = jiraHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanHost}/browse/${jiraKey}`;
}

interface TaskTableProps {
  activeFilter?: string;
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
}

export function TaskTable({ activeFilter, selectedIds, onSelectionChange }: TaskTableProps) {
  // Fetch all tasks (no server-side status filter for filter-based filtering)
  const { data, isLoading, error } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const { data: settingsData } = useSettingsQuery();
  const { data: statusSettings } = useStatusSettingsQuery();
  const { currentTodo } = useCurrentTodo();
  const [todoDialogTask, setTodoDialogTask] = useState<{ id: number; title: string } | null>(null);
  const [logsModalTask, setLogsModalTask] = useState<{ id: number; title: string } | null>(null);

  // Get task ID from current todo for highlighting
  const currentTodoTaskId = currentTodo?.taskId ?? null;

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

  // Build a map of normalized status name -> filter name
  // Used to determine which filter a task belongs to
  const statusToFilterMap = useMemo(() => {
    const map = new Map<string, string>();

    if (statusSettings?.filters) {
      for (const filter of statusSettings.filters) {
        for (const jiraStatus of filter.jiraMappings) {
          map.set(normalizeStatus(jiraStatus), filter.name);
        }
      }
    }

    return map;
  }, [statusSettings?.filters]);

  // Client-side filtering by active filter
  const filteredTasks = useMemo(() => {
    if (!data?.items) return [];
    if (!activeFilter) return data.items; // "All" tab shows everything

    return data.items.filter((task) => {
      const normalizedStatus = normalizeStatus(task.status);
      // Get filter for this status
      const taskFilter = statusToFilterMap.get(normalizedStatus);
      return taskFilter === activeFilter;
    });
  }, [data?.items, activeFilter, statusToFilterMap]);

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
            {onSelectionChange && (
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds?.has(t.id))}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onSelectionChange(new Set(filteredTasks.map((t) => t.id)));
                    } else {
                      onSelectionChange(new Set());
                    }
                  }}
                />
              </TableHead>
            )}
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
              isSelected={selectedIds?.has(task.id) ?? false}
              isCurrentTodoTask={task.id === currentTodoTaskId}
              onSelectionChange={onSelectionChange ? (selected) => {
                const newSelection = new Set(selectedIds);
                if (selected) {
                  newSelection.add(task.id);
                } else {
                  newSelection.delete(task.id);
                }
                onSelectionChange(newSelection);
              } : undefined}
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
  isSelected: boolean;
  isCurrentTodoTask: boolean;
  onSelectionChange?: (selected: boolean) => void;
}

function TaskRow({ task, repo, jiraHost, onOpenTodos, onOpenLogs, isSelected, isCurrentTodoTask, onSelectionChange }: TaskRowProps) {
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
    <TableRow className={isCurrentTodoTask ? "!bg-yellow-50 dark:!bg-yellow-300/40" : undefined}>
      {/* Checkbox */}
      {onSelectionChange && (
        <TableCell>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelectionChange(!!checked)}
            onClick={(e) => e.stopPropagation()}
          />
        </TableCell>
      )}
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
