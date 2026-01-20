import { useState } from "react";
import { useCreateTodo, useToggleTodo, useDeleteTodo } from "@/client/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Todo } from "@/client/lib/types";

interface TodoListProps {
  todos: Todo[];
  taskId: number;
}

export function TodoList({ todos, taskId }: TodoListProps) {
  const [newTodo, setNewTodo] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const createTodo = useCreateTodo();
  const toggleTodo = useToggleTodo();
  const deleteTodo = useDeleteTodo();

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
        {!isAdding && (
          <Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 group"
            >
              <Checkbox
                checked={!!todo.done}
                onCheckedChange={() => handleToggle(todo.id)}
              />
              <span
                className={`flex-1 text-sm ${
                  todo.done ? "line-through text-muted-foreground" : ""
                }`}
              >
                {todo.content}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDelete(todo.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {isAdding && (
            <li className="flex items-center gap-3 p-2">
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
          {todos.length === 0 && !isAdding && (
            <li className="text-muted-foreground text-sm">No todos yet</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
