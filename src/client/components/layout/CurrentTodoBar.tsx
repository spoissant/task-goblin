import { useMemo } from "react";
import { Link } from "react-router";
import { useTodosQuery, useToggleTodo, useSkipTodo } from "@/client/lib/queries";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Button } from "@/client/components/ui/button";
import { SkipForward } from "lucide-react";
import { toast } from "sonner";

export function CurrentTodoBar() {
  const { data, isLoading } = useTodosQuery({ done: false });
  const toggleTodo = useToggleTodo();
  const skipTodo = useSkipTodo();

  const currentTodo = useMemo(() => {
    if (!data?.items) return null;

    // Apply grouping logic: non-task todos always included, first undone todo per task only
    const seenTasks = new Set<number>();
    const grouped = data.items.filter((todo) => {
      if (!todo.taskId) return true;
      if (seenTasks.has(todo.taskId)) return false;
      seenTasks.add(todo.taskId);
      return true;
    });

    // Return first item (already sorted by position from API)
    return grouped[0] ?? null;
  }, [data?.items]);

  const handleToggle = () => {
    if (!currentTodo) return;
    toggleTodo.mutate(currentTodo.id, {
      onError: () => toast.error("Failed to complete todo"),
    });
  };

  const handleSkip = () => {
    if (!currentTodo) return;
    skipTodo.mutate(currentTodo.id, {
      onError: () => toast.error("Failed to skip todo"),
    });
  };

  if (isLoading || !currentTodo) return null;

  return (
    <div className="w-full border-b bg-muted/30 px-4 py-2">
      <div className="flex items-center gap-3 max-w-4xl mx-auto">
        <Checkbox
          checked={false}
          onCheckedChange={handleToggle}
          disabled={toggleTodo.isPending}
        />
        <div className="flex-1 min-w-0">
          {currentTodo.task && (
            <Link
              to={`/tasks/${currentTodo.taskId}`}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline truncate block"
            >
              {currentTodo.task.jiraKey ? `${currentTodo.task.jiraKey}: ` : ""}
              {currentTodo.task.title}
            </Link>
          )}
          <span className="text-sm block truncate">{currentTodo.content}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSkip}
          disabled={skipTodo.isPending}
          title="Skip to next todo"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
