import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdateTodo, useChoreDefinitionsQuery } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
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
  const [editIsChore, setEditIsChore] = useState(!!todo.isCustomChore);
  const [editChoreRank, setEditChoreRank] = useState(String(todo.choreRank ?? ""));
  const [editChorePrompt, setEditChorePrompt] = useState(todo.chorePrompt ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
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
    setEditIsChore(!!todo.isCustomChore);
    setEditChoreRank(String(todo.choreRank ?? ""));
    setEditChorePrompt(todo.chorePrompt ?? "");
  };

  const handleSave = () => {
    const trimmed = editValue.trim();

    // A custom chore needs both a rank and a prompt — keep editing open until provided.
    if (editIsChore && (!editChoreRank || !editChorePrompt.trim())) {
      toast.error("A custom chore needs a rank and an action prompt");
      return;
    }

    const choreChanged =
      editIsChore !== !!todo.isCustomChore ||
      (editIsChore && (editChoreRank !== String(todo.choreRank ?? "") || editChorePrompt !== (todo.chorePrompt ?? "")));
    const changed = (trimmed && trimmed !== todo.content) || choreChanged;

    if (changed && trimmed) {
      const updates: Parameters<typeof updateTodo.mutate>[0] = {
        id: todo.id,
        content: trimmed,
        isCustomChore: editIsChore,
        choreRank: editIsChore && editChoreRank ? parseInt(editChoreRank, 10) : null,
        chorePrompt: editIsChore ? editChorePrompt.trim() || null : null,
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
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      resetEdits();
      setIsEditing(false);
    }
  };

  const choreName = todo.isCustomChore && todo.choreRank
    ? choreDefinitions?.items.find((d) => d.number === todo.choreRank)?.name
    : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-card hover:bg-muted/50 group"
    >
      <div className="flex items-center gap-2 p-2">
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
            onBlur={editIsChore ? undefined : handleSave}
            onKeyDown={editIsChore ? undefined : handleKeyDown}
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
        {todo.isCustomChore && !isEditing && (
          <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded shrink-0">
            chore{choreName ? ` · before #${todo.choreRank} ${choreName}` : ""}
          </span>
        )}
        {editable && isEditing && !editIsChore && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-amber-600 dark:text-amber-400 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditIsChore(true)}
          >
            Make chore
          </Button>
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
      {editable && isEditing && editIsChore && (
        <div className="px-10 pb-2 space-y-2">
          <Select value={editChoreRank} onValueChange={setEditChoreRank}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Run before..." />
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
            placeholder="Action prompt..."
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
