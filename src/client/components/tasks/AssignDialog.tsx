import { useState } from "react";
import { useAssignJira, useAssignPr } from "@/client/lib/queries/tasks";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { toast } from "sonner";

const KINDS = {
  jira: {
    title: "Assign Jira key",
    label: "Jira key",
    placeholder: "PROJ-123",
    assigned: "Jira key assigned",
    failed: "Failed to assign Jira key",
  },
  pr: {
    title: "Assign PR",
    label: "PR URL",
    placeholder: "https://github.com/owner/repo/pull/123",
    assigned: "PR assigned",
    failed: "Failed to assign PR",
  },
};

interface AssignDialogProps {
  /** Attach a Jira key to a PR task, or a PR (by URL) to a task without one. */
  kind: keyof typeof KINDS;
  taskId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignDialog({ kind, taskId, open, onOpenChange }: AssignDialogProps) {
  const assignJira = useAssignJira();
  const assignPr = useAssignPr();
  const [value, setValue] = useState("");
  const text = KINDS[kind];
  const trimmed = value.trim();
  const isPending = assignJira.isPending || assignPr.isPending;

  const handleSubmit = () => {
    if (!trimmed || isPending) return;
    const callbacks = {
      onSuccess: () => {
        toast.success(text.assigned);
        setValue("");
        onOpenChange(false);
      },
      onError: (err: Error) => toast.error(err instanceof Error ? err.message : text.failed),
    };
    if (kind === "jira") assignJira.mutate({ id: taskId, key: trimmed }, callbacks);
    else assignPr.mutate({ id: taskId, url: trimmed }, callbacks);
  };

  const footer = (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button onClick={handleSubmit} disabled={!trimmed || isPending}>
        {isPending ? "Assigning..." : "Assign"}
      </Button>
    </>
  );

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={text.title} footer={footer}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="assign-value">{text.label}</Label>
          <Input
            id="assign-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder={text.placeholder}
            autoFocus
          />
        </div>
      </div>
    </ModalDialog>
  );
}
