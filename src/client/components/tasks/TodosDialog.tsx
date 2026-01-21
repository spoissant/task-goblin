import { useState, useMemo, useRef, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useTodosQuery,
  useToggleTodo,
  useUpdateTodo,
  useDeleteTodo,
  useReorderTodo,
  useCreateTodo,
} from "@/client/lib/queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Skeleton } from "@/client/components/ui/skeleton";
import { GripVertical, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { TodoWithTask } from "@/client/lib/types";

interface TodosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  taskTitle: string;
}

export function TodosDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
}: TodosDialogProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [newTodo, setNewTodo] = useState("");

  const { data, isLoading } = useTodosQuery({ taskId });
  const toggleTodo = useToggleTodo();
  const deleteTodo = useDeleteTodo();
  const reorderTodo = useReorderTodo();
  const createTodo = useCreateTodo();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { pendingTodos, completedTodos } = useMemo(() => {
    if (!data?.items) return { pendingTodos: [], completedTodos: [] };
    const pending = data.items.filter((todo) => !todo.done);
    const completed = data.items.filter((todo) => !!todo.done);
    return { pendingTodos: pending, completedTodos: completed };
  }, [data?.items]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const allTodos = showCompleted
      ? [...pendingTodos, ...completedTodos]
      : pendingTodos;
    const oldIndex = allTodos.findIndex((t) => t.id === active.id);
    const newIndex = allTodos.findIndex((t) => t.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const targetTodo = allTodos[newIndex];
    const newPosition = targetTodo.position ?? newIndex + 1;

    reorderTodo.mutate(
      { id: Number(active.id), position: newPosition },
      {
        onError: () => {
          toast.error("Failed to reorder todo");
        },
      }
    );
  };

  const handleToggle = (id: number) => {
    toggleTodo.mutate(id, {
      onError: () => {
        toast.error("Failed to toggle todo");
      },
    });
  };

  const handleDelete = (id: number) => {
    deleteTodo.mutate(id, {
      onError: () => {
        toast.error("Failed to delete todo");
      },
    });
  };

  const handleAdd = () => {
    if (!newTodo.trim()) return;

    createTodo.mutate(
      { content: newTodo.trim(), taskId },
      {
        onSuccess: () => {
          setNewTodo("");
        },
        onError: () => {
          toast.error("Failed to create todo");
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd();
    }
  };

  const displayedTodos = showCompleted
    ? [...pendingTodos, ...completedTodos]
    : pendingTodos;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Todos</DialogTitle>
          <p className="text-sm text-muted-foreground truncate" title={taskTitle}>
            {taskTitle}
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2">
          <Checkbox
            id="show-completed"
            checked={showCompleted}
            onCheckedChange={(checked) => setShowCompleted(checked === true)}
          />
          <Label htmlFor="show-completed" className="text-sm cursor-pointer">
            Show completed ({completedTodos.length})
          </Label>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : displayedTodos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No todos yet
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayedTodos.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1">
                  {displayedTodos.map((todo) => (
                    <SortableTodoRow
                      key={todo.id}
                      todo={todo}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a todo..."
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!newTodo.trim() || createTodo.isPending}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SortableTodoRowProps {
  todo: TodoWithTask;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

function SortableTodoRow({ todo, onToggle, onDelete }: SortableTodoRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(todo.content);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateTodo = useUpdateTodo();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== todo.content) {
      updateTodo.mutate(
        { id: todo.id, content: trimmed },
        {
          onError: () => {
            toast.error("Failed to update todo");
            setEditValue(todo.content);
          },
        }
      );
    } else {
      setEditValue(todo.content);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(todo.content);
      setIsEditing(false);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-muted/50 group"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        checked={!!todo.done}
        onCheckedChange={() => onToggle(todo.id)}
      />
      {isEditing ? (
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="flex-1 h-7 text-sm"
        />
      ) : (
        <span
          onClick={() => setIsEditing(true)}
          className={`flex-1 text-sm truncate cursor-text ${
            todo.done ? "line-through text-muted-foreground" : ""
          }`}
        >
          {todo.content}
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={() => onDelete(todo.id)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </li>
  );
}
