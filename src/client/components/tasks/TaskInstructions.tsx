import { useState } from "react";
import { useUpdateTask } from "@/client/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { MarkdownField } from "./MarkdownField";
import type { TaskDetail } from "@/client/lib/types";

interface TaskInstructionsProps {
  task: TaskDetail;
}

export function TaskInstructions({ task }: TaskInstructionsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const updateTask = useUpdateTask();

  const handleSave = (instructions: string) => {
    updateTask.mutate(
      { id: task.id, instructions: instructions || undefined },
      {
        onSuccess: () => {
          toast.success("Instructions updated");
          setIsEditing(false);
        },
        onError: () => {
          toast.error("Failed to update instructions");
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Instructions</CardTitle>
            <CardDescription>
              The instructions are essentially the AI plan. This is what we provide to the AI once we want it to execute the task.
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
          value={task.instructions}
          onSave={handleSave}
          isEditing={isEditing}
          onEditingChange={setIsEditing}
          placeholder="Add instructions..."
          isSaving={updateTask.isPending}
        />
      </CardContent>
    </Card>
  );
}
