import { Link } from "react-router";
import { useCurrentTodo, useToggleTodo, useSkipTodo } from "@/client/lib/queries";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Button } from "@/client/components/ui/button";
import { SkipForward } from "lucide-react";
import { toast } from "sonner";

export function CurrentTodoBar() {
  const { currentTodo, isLoading } = useCurrentTodo();
  const toggleTodo = useToggleTodo();
  const skipTodo = useSkipTodo();

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
    <div className="w-full border-b bg-lime-50 dark:bg-lime-700/40 px-4 py-2">
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
