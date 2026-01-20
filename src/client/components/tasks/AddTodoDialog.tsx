import { useState, useRef, useEffect } from "react";
import { useCreateTodo } from "@/client/lib/queries/todos";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";

interface AddTodoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  taskTitle: string;
}

export function AddTodoDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
}: AddTodoDialogProps) {
  const [content, setContent] = useState("");
  const [placement, setPlacement] = useState<"start" | "end">("end");
  const inputRef = useRef<HTMLInputElement>(null);
  const createTodo = useCreateTodo();

  useEffect(() => {
    if (open) {
      setContent("");
      setPlacement("end");
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    createTodo.mutate(
      { content: content.trim(), taskId, placement },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Todo</DialogTitle>
          <p className="text-sm text-muted-foreground truncate" title={taskTitle}>
            {taskTitle}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            ref={inputRef}
            placeholder="Todo content..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={createTodo.isPending}
          />
          <div className="flex items-center gap-4">
            <span className="text-sm">Add to</span>
            <Label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="placement"
                value="start"
                checked={placement === "start"}
                onChange={() => setPlacement("start")}
                className="accent-primary"
              />
              start
            </Label>
            <Label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="placement"
                value="end"
                checked={placement === "end"}
                onChange={() => setPlacement("end")}
                className="accent-primary"
              />
              end
            </Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
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
  );
}
