import { useState } from "react";
import { useAssignPr } from "@/client/lib/queries/tasks";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { ApiError } from "@/client/lib/api";
import { toast } from "sonner";

interface AssignPrDialogProps {
  taskId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignPrDialog({ taskId, open, onOpenChange }: AssignPrDialogProps) {
  const assignPr = useAssignPr();
  const [url, setUrl] = useState("");

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    assignPr.mutate(
      { id: taskId, url: trimmed },
      {
        onSuccess: () => {
          toast.success("PR assigned");
          setUrl("");
          onOpenChange(false);
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : "Failed to assign PR";
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
      <Button onClick={handleSubmit} disabled={!url.trim() || assignPr.isPending}>
        {assignPr.isPending ? "Assigning..." : "Assign"}
      </Button>
    </>
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign PR"
      footer={footer}
    >
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="pr-url">PR URL</Label>
          <Input
            id="pr-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !assignPr.isPending) {
                handleSubmit();
              }
            }}
            placeholder="https://github.com/owner/repo/pull/123"
            autoFocus
          />
        </div>
      </div>
    </ModalDialog>
  );
}
