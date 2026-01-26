import { useState, useMemo } from "react";
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
import { useCreateTodo, useToggleTodo, useDeleteTodo, useReorderTodo, usePromoteTodo, useCurrentTodo } from "@/client/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Plus, Trash2, GripVertical, ArrowUpToLine } from "lucide-react";
import { toast } from "sonner";
import { Linkify } from "@/client/components/ui/Linkify";
import type { Todo } from "@/client/lib/types";

interface TodoListProps {
  todos: Todo[];
  taskId: number;
  showCompleted?: boolean;
  onShowCompletedChange?: (value: boolean) => void;
}

interface SortableTodoProps {
  todo: Todo;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

function SortableTodo({ todo, onToggle, onDelete }: SortableTodoProps) {
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 group"
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
      <span
        className={`flex-1 text-sm ${
          todo.done ? "line-through text-muted-foreground" : ""
        }`}
      >
        <Linkify>{todo.content}</Linkify>
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onDelete(todo.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

export function TodoList({ todos, taskId, showCompleted, onShowCompletedChange }: TodoListProps) {
  const [newTodo, setNewTodo] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const createTodo = useCreateTodo();
  const toggleTodo = useToggleTodo();
  const deleteTodo = useDeleteTodo();
  const reorderTodo = useReorderTodo();
  const promoteTodo = usePromoteTodo();
  const { currentTodo } = useCurrentTodo();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter and sort todos by position
  const sortedTodos = useMemo(() => {
    const filtered = showCompleted !== undefined
      ? todos.filter((t) => showCompleted || !t.done)
      : todos;
    return [...filtered].sort((a, b) => {
      const posA = a.position ?? 999999;
      const posB = b.position ?? 999999;
      return posA - posB;
    });
  }, [todos, showCompleted]);

  // First undone todo from this task
  const firstUndoneTodo = useMemo(() => {
    return sortedTodos.find((t) => !t.done);
  }, [sortedTodos]);

  // Show "To Top" button when:
  // 1. This task has undone todos
  // 2. Current global todo is NOT from this task
  const showToTopButton = firstUndoneTodo && currentTodo?.taskId !== taskId;

  const handlePromote = () => {
    if (!firstUndoneTodo) return;
    promoteTodo.mutate(firstUndoneTodo.id, {
      onError: () => {
        toast.error("Failed to promote todo");
      },
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = sortedTodos.findIndex((t) => t.id === active.id);
    const newIndex = sortedTodos.findIndex((t) => t.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Calculate new position based on neighbors
    const targetTodo = sortedTodos[newIndex];
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

  const handleAdd = () => {
    if (!newTodo.trim()) return;

    createTodo.mutate(
      { content: newTodo.trim(), taskId },
      {
        onSuccess: () => {
          setNewTodo("");
          setIsAdding(false);
        },
        onError: () => {
          toast.error("Failed to create todo");
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd();
    } else if (e.key === "Escape") {
      setNewTodo("");
      setIsAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Todos</CardTitle>
        <div className="flex items-center gap-4">
          {onShowCompletedChange && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={showCompleted}
                onCheckedChange={(checked) => onShowCompletedChange(checked === true)}
              />
              Show completed
            </label>
          )}
          {showToTopButton && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePromote}
              disabled={promoteTodo.isPending}
            >
              <ArrowUpToLine className="h-4 w-4 mr-1" />
              To Top
            </Button>
          )}
          {!isAdding && (
            <Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedTodos.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {sortedTodos.map((todo) => (
                <SortableTodo
                  key={todo.id}
                  todo={todo}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
              {isAdding && (
                <li className="flex items-center gap-3 p-2">
                  <div className="w-4" />
                  <Checkbox disabled />
                  <Input
                    value={newTodo}
                    onChange={(e) => setNewTodo(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add a todo..."
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={handleAdd}
                    disabled={!newTodo.trim() || createTodo.isPending}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setNewTodo("");
                      setIsAdding(false);
                    }}
                  >
                    Cancel
                  </Button>
                </li>
              )}
              {sortedTodos.length === 0 && !isAdding && (
                <li className="text-muted-foreground text-sm">No todos yet</li>
              )}
            </ul>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}
