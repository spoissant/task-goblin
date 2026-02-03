import { useState } from "react";
import {
  useBlockersQuery,
  useCreateBlocker,
  useDeleteBlocker,
  useTasksQuery,
  useTaskQuery,
  useTodoQuery,
} from "@/client/lib/queries";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge"; // Used for Todo badge
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Plus, X, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";

interface BlockersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  taskTitle: string;
}

export function BlockersDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
}: BlockersDialogProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");

  const { data: blockersData, isLoading: blockersLoading } = useBlockersQuery(taskId);
  const { data: tasksData } = useTasksQuery({});
  const createBlocker = useCreateBlocker();
  const deleteBlocker = useDeleteBlocker();

  // Filter out tasks that are already blockers or the current task itself
  const existingBlockerTaskIds = new Set(
    blockersData?.items
      .filter((b) => b.blockerTaskId !== null)
      .map((b) => b.blockerTaskId) ?? []
  );

  const availableTasks =
    tasksData?.items.filter(
      (t) => t.id !== taskId && !existingBlockerTaskIds.has(t.id)
    ) ?? [];

  const handleAdd = () => {
    if (!selectedTaskId) return;

    createBlocker.mutate(
      {
        blockedTaskId: taskId,
        blockerTaskId: Number(selectedTaskId),
      },
      {
        onSuccess: () => {
          setSelectedTaskId("");
        },
        onError: () => {
          toast.error("Failed to add blocker");
        },
      }
    );
  };

  const handleRemove = (blockerId: number) => {
    deleteBlocker.mutate(
      { id: blockerId, blockedTaskId: taskId },
      {
        onError: () => {
          toast.error("Failed to remove blocker");
        },
      }
    );
  };

  const footer = (
    <div className="flex items-center gap-2 w-full">
      <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select a task to block..." />
        </SelectTrigger>
        <SelectContent>
          {availableTasks.map((task) => (
            <SelectItem key={task.id} value={String(task.id)}>
              {task.jiraKey ? `[${task.jiraKey}] ` : ""}
              {task.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={handleAdd}
        disabled={!selectedTaskId || createBlocker.isPending}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add
      </Button>
    </div>
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Blockers"
      description={taskTitle}
      size="md"
      footer={footer}
    >
      {blockersLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !blockersData?.items.length ? (
        <div className="text-center py-8 text-muted-foreground">
          No blockers
        </div>
      ) : (
        <ul className="space-y-2">
          {blockersData.items.map((blocker) => (
            <BlockerRow
              key={blocker.id}
              blocker={blocker}
              onRemove={() => handleRemove(blocker.id)}
            />
          ))}
        </ul>
      )}
    </ModalDialog>
  );
}

interface BlockerRowProps {
  blocker: {
    id: number;
    blockerTaskId: number | null;
    blockerTodoId: number | null;
  };
  onRemove: () => void;
}

// Helper to normalize status name (case-insensitive, handles underscore/space variants)
function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

function BlockerRow({ blocker, onRemove }: BlockerRowProps) {
  // Fetch task details if it's a task blocker
  const { data: taskData, isLoading: taskLoading } = useTaskQuery(blocker.blockerTaskId ?? 0);
  // Fetch todo details if it's a todo blocker
  const { data: todoData, isLoading: todoLoading } = useTodoQuery(blocker.blockerTodoId ?? 0);
  // Fetch status settings to determine if task status is completed
  const { data: statusSettings } = useStatusSettingsQuery();

  // Check if a task status is completed based on status categories
  const isTaskCompleted = (status: string): boolean => {
    if (!statusSettings?.categories) return false;
    const normalized = normalizeStatus(status);

    for (const category of statusSettings.categories) {
      if (category.done) {
        // Check category name
        if (normalizeStatus(category.name) === normalized) {
          return true;
        }
        // Check jiraMappings array
        for (const jiraStatus of category.jiraMappings) {
          if (normalizeStatus(jiraStatus) === normalized) {
            return true;
          }
        }
      }
    }
    return false;
  };

  if (blocker.blockerTodoId !== null) {
    // Todo blocker
    if (todoLoading) {
      return <Skeleton className="h-10 w-full" />;
    }

    const isComplete = todoData?.done !== null;

    return (
      <li className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge className="bg-slate-500 text-white shrink-0">Todo</Badge>
          {isComplete ? (
            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
          )}
          <span className="text-sm truncate">
            {todoData?.content ?? `Todo #${blocker.blockerTodoId}`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </li>
    );
  }

  // Task blocker
  if (taskLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  const isComplete = taskData?.status ? isTaskCompleted(taskData.status) : false;

  return (
    <li className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {taskData?.status && (
          <StatusBadge status={taskData.status} className="shrink-0" />
        )}
        {isComplete ? (
          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
        )}
        <span className="text-sm truncate">
          {taskData?.jiraKey ? `[${taskData.jiraKey}] ` : ""}
          {taskData?.title ?? `Task #${blocker.blockerTaskId}`}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}
