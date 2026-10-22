import { useState } from "react";
import { useUpdateTask } from "@/client/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { Button } from "@/client/components/ui/button";
import { Markdown } from "@/client/components/ui/markdown";
import { InteractiveStatusBadge } from "./InteractiveStatusBadge";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { TaskDetail } from "@/client/lib/types";

interface TaskHeaderProps {
  task: TaskDetail;
  /** Off when the page's summary bar already shows the status picker. */
  showStatus: boolean;
}

export function TaskHeader({ task, showStatus }: TaskHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");

  const updateTask = useUpdateTask();

  const handleSave = () => {
    updateTask.mutate(
      {
        id: task.id,
        title: title.trim(),
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Task updated");
          setIsEditing(false);
        },
        onError: () => {
          toast.error("Failed to update task");
        },
      },
    );
  };

  const handleCancel = () => {
    setTitle(task.title);
    setDescription(task.description || "");
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {isEditing ? (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-xl font-semibold"
                autoFocus
              />
            ) : (
              <CardTitle className="text-xl">{task.title}</CardTitle>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showStatus && <InteractiveStatusBadge taskId={task.id} status={task.status} jiraKey={task.jiraKey} />}
            {isEditing ? (
              <>
                <Button size="icon" variant="ghost" onClick={handleSave}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={handleCancel}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : !task.jiraKey ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {!task.jiraKey && (
        <CardContent>
          {isEditing ? (
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={3}
            />
          ) : task.description ? (
            <Markdown className="text-muted-foreground">{task.description}</Markdown>
          ) : (
            <p className="text-muted-foreground">No description</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
