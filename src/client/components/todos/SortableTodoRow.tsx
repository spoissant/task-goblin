import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdateTodo } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { GripVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Linkify } from "@/client/components/ui/Linkify";
import type { Todo } from "@/client/lib/types";

export interface SortableTodoRowProps {
  todo: Todo;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  editable?: boolean;
}

export function SortableTodoRow({ todo, onToggle, onDelete, editable = true }: SortableTodoRowProps) {
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
      {editable && isEditing ? (
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
          onClick={editable ? () => setIsEditing(true) : undefined}
          className={`flex-1 text-sm truncate ${editable ? "cursor-text" : ""} ${
            todo.done ? "line-through text-muted-foreground" : ""
          }`}
        >
          <Linkify>{todo.content}</Linkify>
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
