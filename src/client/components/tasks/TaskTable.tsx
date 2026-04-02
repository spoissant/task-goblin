import { useMemo, useState } from "react";
import { useTasksQuery, useRepositoriesQuery, useSyncTask } from "@/client/lib/queries";
import { useSettingsQuery, useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { normalizeStatus } from "@/client/lib/utils";
import type { StatusCategory } from "@/client/lib/types";
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
import { RefreshCw, ListTodo } from "lucide-react";
import { TodosDialog } from "./TodosDialog";
import { TABLE_COLUMNS, getPrUrl, getColumn } from "./columns";
import type { TaskWithTodos, Repository } from "@/client/lib/types";
import { EmptyState } from "@/client/components/ui/empty-state";

// Map Tailwind bg class to rgba for faint row tinting
const STATUS_ROW_COLORS: Record<string, { light: string; dark: string }> = {
  "bg-slate-500":   { light: "rgba(100,116,139,0.07)", dark: "rgba(100,116,139,0.12)" },
  "bg-fuchsia-500": { light: "rgba(217,70,239,0.07)",  dark: "rgba(217,70,239,0.12)" },
  "bg-yellow-600":  { light: "rgba(202,138,4,0.07)",   dark: "rgba(202,138,4,0.12)" },
  "bg-blue-600":    { light: "rgba(37,99,235,0.07)",   dark: "rgba(37,99,235,0.12)" },
  "bg-green-700":   { light: "rgba(21,128,61,0.07)",   dark: "rgba(21,128,61,0.12)" },
  "bg-red-500":     { light: "rgba(239,68,68,0.07)",   dark: "rgba(239,68,68,0.12)" },
};

function getStatusRowColor(status: string, categories?: StatusCategory[]): { light: string; dark: string } | undefined {
  if (!categories) return undefined;
  const normalized = normalizeStatus(status);
  for (const cat of categories) {
    if (normalizeStatus(cat.name) === normalized) return STATUS_ROW_COLORS[cat.color];
    for (const jiraStatus of cat.jiraMappings) {
      if (normalizeStatus(jiraStatus) === normalized) return STATUS_ROW_COLORS[cat.color];
    }
  }
  return undefined;
}

interface TaskTableProps {
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
  titleFilter?: string;
  highlightedTaskId?: number | null;
  hideLowPriority?: boolean;
}

export function TaskTable({ selectedIds, onSelectionChange, titleFilter, highlightedTaskId, hideLowPriority }: TaskTableProps) {
  const { data, isLoading, error } = useTasksQuery({ title: titleFilter });
  const { data: reposData } = useRepositoriesQuery();
  const { data: settingsData } = useSettingsQuery();
  const { data: statusSettings } = useStatusSettingsQuery();
  const [todoDialogTask, setTodoDialogTask] = useState<{ id: number; title: string } | null>(null);

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

  const allTasks = data?.items ?? [];
  const tasks = hideLowPriority ? allTasks.filter((t) => t.sprint || t.highPriority) : allTasks;

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
              statusCategories={statusSettings?.categories}
              onOpenTodos={() => setTodoDialogTask({ id: task.id, title: task.title })}
              isSelected={selectedIds?.has(task.id) ?? false}
              isHighlighted={highlightedTaskId === task.id}
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
    </TooltipProvider>
  );
}

interface TaskRowProps {
  task: TaskWithTodos;
  repo?: Repository;
  jiraHost: string | null;
  statusCategories?: StatusCategory[];
  onOpenTodos: () => void;
  isSelected: boolean;
  isHighlighted?: boolean;
  onSelectionChange?: (selected: boolean) => void;
}

function TaskRow({ task, repo, jiraHost, statusCategories, onOpenTodos, isSelected, isHighlighted, onSelectionChange }: TaskRowProps) {
  const syncTask = useSyncTask();

  // Build GitHub PR URL if we have repo info
  const prUrl = getPrUrl(repo, task.prNumber);

  // Only show sync if task has Jira or PR
  const canSync = task.jiraKey || task.prNumber;

  const handleSync = () => {
    syncTask.mutate({ task, repo });
  };

  // Context for column renderers
  const columnContext = {
    repo,
    jiraHost,
    prUrl,
    linkToTask: true,
  };

  const isDark = document.documentElement.classList.contains("dark");
  const rowColor = getStatusRowColor(task.status, statusCategories);
  const rowBg = rowColor ? (isDark ? rowColor.dark : rowColor.light) : undefined;

  return (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      className={[
        isHighlighted && "task-highlight",
        isSelected && "task-selected",
      ].filter(Boolean).join(" ") || undefined}
      style={rowBg ? { backgroundColor: rowBg } : undefined}
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
