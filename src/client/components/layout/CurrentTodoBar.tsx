import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";
import { useCurrentTodo, useToggleTodo, useSkipTodo } from "@/client/lib/queries";
import { useCreateTodo } from "@/client/lib/queries/todos";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Linkify } from "@/client/components/ui/Linkify";
import { ExternalLink, Plus, SkipForward } from "lucide-react";
import { toast } from "sonner";

export function CurrentTodoBar() {
  const { currentTodo, isLoading } = useCurrentTodo();
  const toggleTodo = useToggleTodo();
  const skipTodo = useSkipTodo();
  const createTodo = useCreateTodo();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [content, setContent] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialogOpen) {
      setContent("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [dialogOpen]);

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

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    createTodo.mutate(
      { content: content.trim(), placement: "end" },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setContent("");
        },
        onError: () => toast.error("Failed to create todo"),
      }
    );
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
          <span className="text-sm block truncate"><Linkify>{currentTodo.content}</Linkify></span>
        </div>
        {currentTodo.task && (
          <Button
            size="sm"
            variant="ghost"
            asChild
            title="Open task"
          >
            <Link to={`/tasks/${currentTodo.taskId}`}>
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSkip}
          disabled={skipTodo.isPending}
          title="Skip to next todo"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDialogOpen(true)}
          title="Add new todo"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Todo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddTodo} className="space-y-4">
            <Input
              ref={inputRef}
              placeholder="Todo content..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={createTodo.isPending}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={createTodo.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!content.trim() || createTodo.isPending}>
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
