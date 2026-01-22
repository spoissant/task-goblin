import { useState } from "react";
import { useUpdateTask } from "@/client/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { MarkdownField } from "./MarkdownField";
import type { TaskDetail } from "@/client/lib/types";

interface TaskNotesProps {
  task: TaskDetail;
}

export function TaskNotes({ task }: TaskNotesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const updateTask = useUpdateTask();

  const handleSave = (notes: string) => {
    updateTask.mutate(
      { id: task.id, notes: notes || undefined },
      {
        onSuccess: () => {
          toast.success("Notes updated");
          setIsEditing(false);
        },
        onError: () => {
          toast.error("Failed to update notes");
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Notes</CardTitle>
            <CardDescription>
              Notes help you give more context that is missing from the description. It allows you to provide additional information that the AI can use to build the instructions.
            </CardDescription>
          </div>
          {!isEditing && (
            <Button size="icon" variant="ghost" onClick={() => setIsEditing(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <MarkdownField
          value={task.notes}
          onSave={handleSave}
          isEditing={isEditing}
          onEditingChange={setIsEditing}
          placeholder="Add notes..."
          isSaving={updateTask.isPending}
        />
      </CardContent>
    </Card>
  );
}
