import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdateTodo, useChoreDefinitionsQuery } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
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
  const [editChoreRank, setEditChoreRank] = useState(String(todo.choreRank ?? ""));
  const [editChorePrompt, setEditChorePrompt] = useState(todo.chorePrompt ?? "");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const updateTodo = useUpdateTodo();
  const { data: choreDefinitions } = useChoreDefinitionsQuery();

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
    setEditChoreRank(String(todo.choreRank ?? ""));
    setEditChorePrompt(todo.chorePrompt ?? "");
  };

  const handleSave = () => {
    const trimmed = editValue.trim();

    const choreChanged =
      editChoreRank !== String(todo.choreRank ?? "") ||
      editChorePrompt.trim() !== (todo.chorePrompt ?? "");
    const changed = (trimmed && trimmed !== todo.content) || choreChanged;

    if (changed && trimmed) {
      const updates: Parameters<typeof updateTodo.mutate>[0] = {
        id: todo.id,
        content: trimmed,
        choreRank: editChoreRank ? parseInt(editChoreRank, 10) : null,
        chorePrompt: editChorePrompt.trim() || null,
      };
      updateTodo.mutate(updates, {
        onError: () => {
          toast.error("Failed to update todo");
          resetEdits();
        },
      });
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

  const choreName = todo.choreRank
    ? choreDefinitions?.items.find((d) => d.number === todo.choreRank)?.name
    : null;

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
        {todo.choreRank != null && !isEditing && (
          <span className="mt-px text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded shrink-0">
            before #{todo.choreRank}{choreName ? ` ${choreName}` : ""}
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
        <div className="px-10 pb-2 space-y-2">
          <Select value={editChoreRank} onValueChange={setEditChoreRank}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Run before... (optional, defaults to #6)" />
            </SelectTrigger>
            <SelectContent>
              {choreDefinitions?.items.map((def) => (
                <SelectItem key={def.number} value={String(def.number)}>
                  {def.number} – {def.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={editChorePrompt}
            onChange={(e) => setEditChorePrompt(e.target.value)}
            placeholder="Prompt override... (optional)"
            className="text-sm resize-none"
            rows={3}
          />
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
