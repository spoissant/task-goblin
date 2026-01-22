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
} from "@dnd-kit/sortable";
import {
  useTodosQuery,
  useToggleTodo,
  useDeleteTodo,
  useReorderTodo,
  useCreateTodo,
} from "@/client/lib/queries";
import { SortableTodoItem } from "@/client/components/todos/SortableTodoItem";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export function TodosPage() {
  const [hideCompleted, setHideCompleted] = useState(true);
  const [groupByTask, setGroupByTask] = useState(false);
  const [newTodo, setNewTodo] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const { data, isLoading, error } = useTodosQuery();
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

  const remainingByTask = useMemo(() => {
    if (!groupByTask || !data?.items) return new Map<number, number>();
    const counts = new Map<number, number>();
    for (const todo of data.items) {
      if (todo.taskId && !todo.done) {
        counts.set(todo.taskId, (counts.get(todo.taskId) ?? 0) + 1);
      }
    }
    // Subtract 1 since we show the first one
    for (const [taskId, count] of counts) {
      counts.set(taskId, count - 1);
    }
    return counts;
  }, [groupByTask, data?.items]);

  const filteredTodos = useMemo(() => {
    if (!data?.items) return [];

    let todos = data.items;

    if (hideCompleted) {
      todos = todos.filter((todo) => !todo.done);
    }

    if (groupByTask) {
      const seenTasks = new Set<number>();
      todos = todos.filter((todo) => {
        if (!todo.taskId) return true; // Keep standalone todos
        if (todo.done) return false; // Skip done when grouping
        if (seenTasks.has(todo.taskId)) return false; // Already showed one for this task
        seenTasks.add(todo.taskId);
        return true;
      });
    }

    return todos;
  }, [data?.items, hideCompleted, groupByTask]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = filteredTodos.findIndex((t) => t.id === active.id);
    const newIndex = filteredTodos.findIndex((t) => t.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Calculate new position based on neighbors
    const targetTodo = filteredTodos[newIndex];
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
      { content: newTodo.trim() },
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd();
    } else if (e.key === "Escape") {
      setNewTodo("");
      setIsAdding(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Todos</h1>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Todos</h1>
        </div>
        <div className="text-center py-12 text-muted-foreground">
          Failed to load todos
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Todos</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="hide-completed"
              checked={hideCompleted}
              onCheckedChange={(checked) => setHideCompleted(checked === true)}
            />
            <Label htmlFor="hide-completed" className="text-sm cursor-pointer">
              Hide completed
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="group-by-task"
              checked={groupByTask}
              onCheckedChange={(checked) => setGroupByTask(checked === true)}
            />
            <Label htmlFor="group-by-task" className="text-sm cursor-pointer">
              Group by task
            </Label>
          </div>
          {!isAdding && (
            <Button onClick={() => setIsAdding(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Todo
            </Button>
          )}
        </div>
      </div>

      {isAdding && (
        <div className="flex items-center gap-3 p-3 mb-4 rounded-md border bg-card">
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
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredTodos.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {filteredTodos.map((todo) => (
              <SortableTodoItem
                key={todo.id}
                todo={todo}
                remainingCount={groupByTask && todo.taskId ? remainingByTask.get(todo.taskId) ?? 0 : 0}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {filteredTodos.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          {hideCompleted && data?.items.length
            ? "All todos completed! Uncheck 'Hide completed' to see them."
            : "No todos yet. Create one to get started!"}
        </div>
      )}
    </div>
  );
}
