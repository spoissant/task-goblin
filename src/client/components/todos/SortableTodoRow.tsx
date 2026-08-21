import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdateTodo } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { Checkbox } from "@/client/components/ui/checkbox";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  const resetEdits = () => {
    setEditValue(todo.content);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();

    if (trimmed && trimmed !== todo.content) {
      updateTodo.mutate(
        { id: todo.id, content: trimmed },
        {
          onError: () => {
            toast.error("Failed to update todo");
            resetEdits();
          },
        }
      );
    } else {
      resetEdits();
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      resetEdits();
      setIsEditing(false);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-card hover:bg-muted/50 group"
    >
      <div className="flex items-start gap-2 p-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={!!todo.done}
          onCheckedChange={() => onToggle(todo.id)}
        />
        {editable && isEditing ? (
          <Textarea
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-h-0 text-sm resize-none"
            rows={Math.min(6, Math.max(2, Math.ceil(editValue.length / 70)))}
          />
        ) : (
          <span
            onClick={editable ? () => setIsEditing(true) : undefined}
            className={`flex-1 min-w-0 text-sm whitespace-pre-wrap break-words ${editable ? "cursor-text" : ""} ${
              todo.done ? "line-through text-muted-foreground" : ""
            }`}
          >
            <Linkify>{todo.content}</Linkify>
          </span>
        )}
        {editable && !isEditing && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => onDelete(todo.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {editable && isEditing && (
        <div className="px-10 pb-2">
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={updateTodo.isPending}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              resetEdits();
              setIsEditing(false);
            }}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}
