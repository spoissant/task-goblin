import { useState } from "react";
import { Snowflake } from "lucide-react";
import type { Task } from "@/shared/types";
import { useUpdateTask } from "@/client/lib/queries/tasks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { Linkify } from "@/client/components/ui/Linkify";

/** The snowflake: freezing a task asks why (its tooltip shows the reason), thawing clears it. */
export function OnIceCell({ task }: { task: Task }) {
  const updateTask = useUpdateTask();
  const isOnIce = !!task.onIce;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(task.onIceReason ?? "");

  const handleOpenChange = (next: boolean) => {
    if (next) setReason(task.onIceReason ?? "");
    setOpen(next);
  };

  const save = (onIce: boolean) =>
    updateTask.mutate(
      { id: task.id, onIce, onIceReason: onIce ? reason.trim() || null : null },
      { onSuccess: () => setOpen(false) },
    );

  const button = (
    <button
      type="button"
      className="cursor-pointer hover:opacity-80"
      onClick={(e) => {
        e.stopPropagation();
        handleOpenChange(true);
      }}
    >
      <Snowflake
        className={`h-4 w-4 transition-colors ${
          isOnIce
            ? "text-sky-400 fill-sky-400/30 ice-glow"
            : "text-muted-foreground/30"
        }`}
      />
    </button>
  );

  const footer = (
    <>
      {isOnIce && (
        <Button variant="outline" onClick={() => save(false)} disabled={updateTask.isPending}>
          Thaw
        </Button>
      )}
      <Button onClick={() => save(true)} disabled={updateTask.isPending}>
        {isOnIce ? "Save" : "Freeze"}
      </Button>
    </>
  );

  return (
    <>
      {isOnIce && task.onIceReason ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap">
            <Linkify>{task.onIceReason}</Linkify>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      <ModalDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={isOnIce ? "On ice" : "Put task on ice"}
        footer={footer}
      >
        <div className="py-4">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this task on ice? (links allowed)"
            rows={5}
            autoFocus
          />
        </div>
      </ModalDialog>
    </>
  );
}
