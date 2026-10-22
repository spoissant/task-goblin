import { useMemo } from "react";
import { useTasksQuery } from "@/client/lib/queries/tasks";
import { useSettingsQuery, useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { cn, findStatusCategory } from "@/client/lib/utils";
import { getPrUrl } from "@/client/lib/links";
import type { TaskFilters } from "@/client/lib/taskFilters";
import type { ClaudeSession, StatusCategory, TaskListItem } from "@/shared/types";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { ColumnCells, ColumnHeads, TABLE_COLUMNS, type ColumnKey } from "./columns";
import { EmptyState } from "@/client/components/ui/empty-state";
import { useChoresQuery } from "@/client/lib/queries/chores";
import type { ChoreEntry } from "@/shared/chores";
import { useLatestSessionsQuery } from "@/client/lib/queries/sessions";
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
  const category = categories && findStatusCategory(status, categories);
  return category ? STATUS_ROW_COLORS[category.color] : undefined;
}

// Columns hidden when compact mode is on
const COMPACT_HIDDEN_COLUMNS = new Set<ColumnKey>([
  "type",
  "sprint",
  "highPriority",
  "onIce",
  "isParent",
  "changes",
]);

interface TaskTableProps {
  filters: TaskFilters;
  titleFilter: string; // the search box AND'd with the active saved searches
  compactMode: boolean;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  onSearch: (query: string) => void;
}

export function TaskTable({ filters, titleFilter, compactMode, selectedIds, onSelectionChange, onSearch }: TaskTableProps) {
  const { data, isLoading, error } = useTasksQuery({ title: titleFilter });
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

  const columns = compactMode ? TABLE_COLUMNS.filter((key) => !COMPACT_HIDDEN_COLUMNS.has(key)) : TABLE_COLUMNS;

  const tasks = (data?.items ?? []).filter((t) => {
    if (filters.sprint && !t.sprint && !t.highPriority) return false;
    if (filters.backlog && t.sprint) return false;
    if (filters.hideOnIce && t.onIce) return false;
    // Same flag the "has sub-tasks" column shows, so what "Hide parents" removes
    // is exactly what carries the parent icon.
    if (filters.hideParents && t.hasChildren) return false;
    if (filters.hideIdle && !choreMap.has(t.id)) return false;
    if (filters.idleOnly && choreMap.has(t.id)) return false;
    if (filters.repo != null && t.repositoryId !== filters.repo) return false;
    return true;
  });

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

  const setSelected = (id: number, selected: boolean) => {
    const next = new Set(selectedIds);
    if (selected) {
      next.add(id);
    } else {
      next.delete(id);
    }
    onSelectionChange(next);
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40px]">
            <Checkbox
              checked={tasks.every((t) => selectedIds.has(t.id))}
              onCheckedChange={(checked) => onSelectionChange(new Set(checked ? tasks.map((t) => t.id) : []))}
            />
          </TableHead>
          <TableHead className="w-[50px]">ID</TableHead>
          <ColumnHeads columns={columns} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            columns={columns}
            jiraHost={jiraHost}
            statusCategories={statusSettings?.categories}
            nextChore={choreMap.get(task.id)}
            session={sessionMap.get(task.id)}
            onSearch={onSearch}
            isSelected={selectedIds.has(task.id)}
            onSelectedChange={(selected) => setSelected(task.id, selected)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

interface TaskRowProps {
  task: TaskListItem;
  columns: ColumnKey[];
  jiraHost: string | null;
  statusCategories?: StatusCategory[];
  nextChore?: ChoreEntry;
  session?: ClaudeSession;
  onSearch: (query: string) => void;
  isSelected: boolean;
  onSelectedChange: (selected: boolean) => void;
}

function TaskRow({ task, columns, jiraHost, statusCategories, nextChore, session, onSearch, isSelected, onSelectedChange }: TaskRowProps) {
  // Context for column renderers
  const columnContext = {
    repo: task.repository,
    jiraHost,
    prUrl: getPrUrl(task.repository, task.prNumber),
    linkToTask: true,
    nextChore,
    session,
    isParent: task.hasChildren,
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
      <TableCell>
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelectedChange(!!checked)}
        />
      </TableCell>
      {/* Task ID */}
      <TableCell>
        <CopyChip value={String(task.id)} message="Task ID copied" title="Copy task ID">
          {task.id}
        </CopyChip>
      </TableCell>
      {/* Shared columns */}
      <ColumnCells task={task} columns={columns} context={columnContext} />
    </TableRow>
  );
}
