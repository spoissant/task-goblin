import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/client/components/ui/textarea";
import { Button } from "@/client/components/ui/button";
import { Check, X } from "lucide-react";

interface MarkdownFieldProps {
  value: string | null;
  onSave: (value: string) => void;
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
  placeholder?: string;
  isSaving?: boolean;
}

export function MarkdownField({
  value,
  onSave,
  isEditing,
  onEditingChange,
  placeholder = "Add content...",
  isSaving = false,
}: MarkdownFieldProps) {
  const [editValue, setEditValue] = useState(value || "");

  const handleSave = () => {
    onSave(editValue.trim());
  };

  const handleCancel = () => {
    setEditValue(value || "");
    onEditingChange(false);
  };

  if (isEditing) {
    return (
      <div className="space-y-2">
        <Textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder={placeholder}
          rows={6}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            <Check className="h-4 w-4 mr-1" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  if (!value) {
    return <p className="text-muted-foreground">{placeholder}</p>;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  );
}
