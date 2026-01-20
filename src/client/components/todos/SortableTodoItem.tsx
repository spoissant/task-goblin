import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Button } from "@/client/components/ui/button";
import { GripVertical, Trash2 } from "lucide-react";
import type { TodoWithTask } from "@/client/lib/types";

interface SortableTodoItemProps {
  todo: TodoWithTask;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

export function SortableTodoItem({ todo, onToggle, onDelete }: SortableTodoItemProps) {
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
      className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-muted/50 group"
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
      <div className="flex-1 min-w-0">
        <span
          className={`text-sm block ${
            todo.done ? "line-through text-muted-foreground" : ""
          }`}
        >
          {todo.content}
        </span>
        {todo.task && (
          <Link
            to={`/tasks/${todo.taskId}`}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline truncate block"
          >
            {todo.task.jiraKey ? `${todo.task.jiraKey}: ` : ""}
            {todo.task.title}
          </Link>
        )}
      </div>
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
