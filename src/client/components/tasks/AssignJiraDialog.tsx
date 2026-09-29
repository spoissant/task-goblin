import { useState } from "react";
import { useAssignJira } from "@/client/lib/queries/tasks";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { ApiError } from "@/client/lib/api";
import { toast } from "sonner";

interface AssignJiraDialogProps {
  taskId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignJiraDialog({ taskId, open, onOpenChange }: AssignJiraDialogProps) {
  const assignJira = useAssignJira();
  const [key, setKey] = useState("");

  const handleSubmit = () => {
    const trimmed = key.trim();
    if (!trimmed) return;

    assignJira.mutate(
      { id: taskId, key: trimmed },
      {
        onSuccess: () => {
          toast.success("Jira key assigned");
          setKey("");
          onOpenChange(false);
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : "Failed to assign Jira key";
          toast.error(msg);
        },
      }
    );
  };

  const footer = (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button onClick={handleSubmit} disabled={!key.trim() || assignJira.isPending}>
        {assignJira.isPending ? "Assigning..." : "Assign"}
      </Button>
    </>
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign Jira key"
      footer={footer}
    >
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="jira-key">Jira key</Label>
          <Input
            id="jira-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && key.trim() && !assignJira.isPending) {
                handleSubmit();
              }
            }}
            placeholder="PROJ-123"
            autoFocus
          />
        </div>
      </div>
    </ModalDialog>
  );
}
