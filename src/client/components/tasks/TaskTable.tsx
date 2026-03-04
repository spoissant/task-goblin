import { useMemo, useState } from "react";
import { useTasksQuery, useRepositoriesQuery, useSyncTask } from "@/client/lib/queries";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/client/components/ui/tooltip";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RefreshCw, ListTodo, Bell } from "lucide-react";
import { TodosDialog } from "./TodosDialog";
import { TaskLogsModal } from "./TaskLogsModal";
import { TABLE_COLUMNS, getPrUrl, getColumn } from "./columns";
import type { TaskWithTodos, Repository } from "@/client/lib/types";
import { EmptyState } from "@/client/components/ui/empty-state";

interface TaskTableProps {
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
  titleFilter?: string;
}

export function TaskTable({ selectedIds, onSelectionChange, titleFilter }: TaskTableProps) {
  const { data, isLoading, error } = useTasksQuery({ title: titleFilter });
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

  const tasks = data?.items ?? [];

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
    return <EmptyState message="Failed to load tasks" />;
  }

  if (!tasks.length) {
    return <EmptyState message="No tasks found" />;
  }

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            {onSelectionChange && (
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={tasks.length > 0 && tasks.every((t) => selectedIds?.has(t.id))}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onSelectionChange(new Set(tasks.map((t) => t.id)));
                    } else {
                      onSelectionChange(new Set());
                    }
                  }}
                />
              </TableHead>
            )}
            <TableHead className="w-[50px]">ID</TableHead>
            <TableHead className="w-[40px]"></TableHead>
            {TABLE_COLUMNS.map((colKey) => {
              const col = getColumn(colKey);
              return (
                <TableHead key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.header}
                </TableHead>
              );
            })}
            <TableHead className="w-[80px]">Todos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              repo={task.repositoryId ? repoMap.get(task.repositoryId) : undefined}
              jiraHost={jiraHost}
              onOpenTodos={() => setTodoDialogTask({ id: task.id, title: task.title })}
              onOpenLogs={() => setLogsModalTask({ id: task.id, title: task.title })}
              isSelected={selectedIds?.has(task.id) ?? false}
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

interface TaskRowProps {
  task: TaskWithTodos;
  repo?: Repository;
  jiraHost: string | null;
  onOpenTodos: () => void;
  onOpenLogs: () => void;
  isSelected: boolean;
  onSelectionChange?: (selected: boolean) => void;
}

function TaskRow({ task, repo, jiraHost, onOpenTodos, onOpenLogs, isSelected, onSelectionChange }: TaskRowProps) {
  const syncTask = useSyncTask();

  // Build GitHub PR URL if we have repo info
  const prUrl = getPrUrl(repo, task.prNumber);

  // Only show sync if task has Jira or PR
  const canSync = task.jiraKey || task.prNumber;

  const handleSync = () => {
    syncTask.mutate({ task, repo });
  };

  const handleOpenLogs = () => {
    onOpenLogs();
  };

  // Context for column renderers
  const columnContext = {
    repo,
    jiraHost,
    prUrl,
    linkToTask: true,
  };

  return (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
    >
      {/* Checkbox */}
      {onSelectionChange && (
        <TableCell>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelectionChange(!!checked)}
          />
        </TableCell>
      )}
      {/* Task ID */}
      <TableCell>
        <button
          type="button"
          className="font-mono text-xs hover:text-blue-600 cursor-pointer"
          onClick={() => {
            navigator.clipboard.writeText(String(task.id));
            toast.success("Task ID copied");
          }}
        >
          {task.id}
        </button>
      </TableCell>
      {/* Sync / Unread Logs */}
      <TableCell>
        <div className="flex items-center gap-1">
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
          {task.unreadLogCount > 0 && (
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
          )}
        </div>
      </TableCell>

      {/* Shared columns */}
      {TABLE_COLUMNS.map((colKey) => {
        const col = getColumn(colKey);
        return (
          <TableCell key={col.key} className={col.cellClassName}>
            {col.render(task, columnContext)}
          </TableCell>
        );
      })}

      {/* Todos */}
      <TableCell>
        <button
          type="button"
          onClick={() => {
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
