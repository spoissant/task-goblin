import { useMemo } from "react";
import { useTasksQuery, useRepositoriesQuery } from "@/client/lib/queries";
import { useSettingsQuery, useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { cn, normalizeStatus } from "@/client/lib/utils";
import type { StatusCategory } from "@/client/lib/types";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Checkbox } from "@/client/components/ui/checkbox";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { TABLE_COLUMNS, getColumn } from "./columns";
import { getPrUrl } from "./columns/cells";
import type { TaskListItem, Repository } from "@/client/lib/types";
import { EmptyState } from "@/client/components/ui/empty-state";
import { useChoresQuery, type ChoreEntry } from "@/client/lib/queries/chores";
import { useLatestSessionsQuery } from "@/client/lib/queries/sessions";
import type { ClaudeSession } from "@/client/lib/types";
import { CopyChip } from "@/client/components/ui/copy-chip";

// Map Tailwind bg class to rgba for faint row tinting
const STATUS_ROW_COLORS: Record<string, string> = {
  "bg-slate-500":   "rgba(100,116,139,0.12)",
  "bg-fuchsia-500": "rgba(217,70,239,0.12)",
  "bg-yellow-600":  "rgba(202,138,4,0.12)",
  "bg-blue-600":    "rgba(37,99,235,0.12)",
  "bg-green-700":   "rgba(21,128,61,0.12)",
  "bg-red-500":     "rgba(239,68,68,0.12)",
};

function getStatusRowColor(status: string, categories?: StatusCategory[]): string | undefined {
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

// Columns hidden when compact mode is on
const COMPACT_HIDDEN_COLUMNS = new Set<(typeof TABLE_COLUMNS)[number]>([
  "type",
  "sprint",
  "highPriority",
  "onIce",
  "isParent",
  "changes",
]);

interface TaskTableProps {
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
  titleFilter?: string;
  hideLowPriority?: boolean;
  backlogOnly?: boolean;
  hideOnIce?: boolean;
  hideParents?: boolean;
  hideIdle?: boolean;
  idleOnly?: boolean;
  compactMode?: boolean;
  repoFilter?: number | null;
  onSearch?: (query: string) => void;
}

export function TaskTable({ selectedIds, onSelectionChange, titleFilter, hideLowPriority, backlogOnly, hideOnIce, hideParents, hideIdle, idleOnly, compactMode, repoFilter, onSearch }: TaskTableProps) {
  const { data, isLoading, error } = useTasksQuery({ title: titleFilter });
  const { data: reposData } = useRepositoriesQuery();
  const { data: settingsData } = useSettingsQuery();
  const { data: statusSettings } = useStatusSettingsQuery();
  const { data: choresData } = useChoresQuery();
  const { data: sessionsData } = useLatestSessionsQuery();

  // Latest AI session per task, a bulk run's linked tasks included (items come newest first)
  const sessionMap = useMemo(() => {
    const map = new Map<number, ClaudeSession>();
    for (const s of sessionsData?.items ?? []) {
      for (const id of [s.taskId, ...s.linkedTaskIds]) if (id !== null && !map.has(id)) map.set(id, s);
    }
    return map;
  }, [sessionsData?.items]);

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

  // Build a map of taskId -> highest-priority ChoreEntry (list is already ordered).
  const choreMap = useMemo(() => {
    const map = new Map<number, ChoreEntry>();
    if (choresData?.items) {
      for (const chore of choresData.items) {
        if (!map.has(chore.task.id)) map.set(chore.task.id, chore);
      }
    }
    return map;
  }, [choresData?.items]);

  const visibleColumns = TABLE_COLUMNS.filter((key) => {
    if (compactMode && COMPACT_HIDDEN_COLUMNS.has(key)) return false;
    return true;
  });

  const allTasks = data?.items ?? [];
  const shownTasks = allTasks.filter((t) => {
    if (hideLowPriority && !t.sprint && !t.highPriority) return false;
    if (backlogOnly && t.sprint) return false;
    if (hideOnIce && t.onIce) return false;
    if (hideIdle && !choreMap.has(t.id)) return false;
    if (idleOnly && choreMap.has(t.id)) return false;
    if (repoFilter != null && t.repositoryId !== repoFilter) return false;
    return true;
  });

  // Same flag the "has sub-tasks" column shows, so what "Hide parents" removes
  // is exactly what carries the parent icon.
  const tasks = hideParents ? shownTasks.filter((t) => !t.hasChildren) : shownTasks;

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
            {visibleColumns.map((colKey) => {
              const col = getColumn(colKey);
              return (
                <TableHead key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.header}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              columns={visibleColumns}
              repo={task.repositoryId ? repoMap.get(task.repositoryId) : undefined}
              jiraHost={jiraHost}
              statusCategories={statusSettings?.categories}
              nextChore={choreMap.get(task.id)}
              session={sessionMap.get(task.id)}
              isParent={task.hasChildren}
              onSearch={onSearch}
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
    </TooltipProvider>
  );
}

interface TaskRowProps {
  task: TaskListItem;
  columns: typeof TABLE_COLUMNS;
  repo?: Repository;
  jiraHost: string | null;
  statusCategories?: StatusCategory[];
  nextChore?: ChoreEntry;
  session?: ClaudeSession;
  isParent: boolean;
  onSearch?: (query: string) => void;
  isSelected: boolean;
  onSelectionChange?: (selected: boolean) => void;
}

function TaskRow({ task, columns, repo, jiraHost, statusCategories, nextChore, session, isParent, onSearch, isSelected, onSelectionChange }: TaskRowProps) {
  // Build GitHub PR URL if we have repo info
  const prUrl = getPrUrl(repo, task.prNumber);

  // Context for column renderers
  const columnContext = {
    repo,
    jiraHost,
    prUrl,
    linkToTask: true,
    nextChore,
    session,
    isParent,
    onSearch,
  };

  const rowBg = getStatusRowColor(task.status, statusCategories);

  return (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      className={cn(isSelected && "task-selected", task.onIce && "opacity-50")}
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
        <CopyChip value={String(task.id)} message="Task ID copied" title="Copy task ID">
          {task.id}
        </CopyChip>
      </TableCell>
      {/* Shared columns */}
      {columns.map((colKey) => {
        const col = getColumn(colKey);
        return (
          <TableCell key={col.key} className={col.cellClassName}>
            {col.render(task, columnContext)}
          </TableCell>
        );
      })}

    </TableRow>
  );
}
