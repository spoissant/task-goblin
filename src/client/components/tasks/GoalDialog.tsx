import { useState, useEffect } from "react";
import { useAssignTasksToGoal, useCreateGoal, useUpdateGoal } from "@/client/lib/queries/goals";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { toast } from "sonner";
import type { Goal } from "@/shared/types";

interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The goal to edit; omitted to create one. */
  goal?: Goal;
  /** Tasks moved into the goal once created (the current selection). */
  assignTaskIds?: number[];
  /** Called after the tasks were moved, so the page can clear its selection. */
  onAssigned?: () => void;
}

/** The goal's epic keys as the comma-separated text of the epics field. */
function goalEpics(goal?: Goal): string {
  try {
    return (JSON.parse(goal?.epicKeys ?? "[]") as string[]).join(", ");
  } catch {
    return "";
  }
}

/** Create a goal (optionally with tasks moved into it), or edit one's name and shared context. */
export function GoalDialog({ open, onOpenChange, goal, assignTaskIds = [], onAssigned }: GoalDialogProps) {
  const [name, setName] = useState(goal?.name ?? "");
  const [context, setContext] = useState(goal?.context ?? "");
  const [epics, setEpics] = useState(goalEpics(goal));
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const assignTasks = useAssignTasksToGoal();
  const isPending = createGoal.isPending || updateGoal.isPending || assignTasks.isPending;

  // Reset the fields each time the dialog opens
  useEffect(() => {
    if (open) {
      setName(goal?.name ?? "");
      setContext(goal?.context ?? "");
      setEpics(goalEpics(goal));
    }
  }, [open, goal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const data = { name: trimmed, context: context.trim() || null, epicKeys: epics.split(/[\s,]+/).filter(Boolean) };
    if (goal) {
      updateGoal.mutate(
        { id: goal.id, ...data },
        {
          onSuccess: () => {
            toast.success("Goal updated");
            onOpenChange(false);
          },
          onError: (error) => toast.error(error.message || "Failed to update goal"),
        },
      );
      return;
    }
    createGoal.mutate(data, {
      onSuccess: async (createdGoal) => {
        if (assignTaskIds.length) {
          try {
            await assignTasks.mutateAsync({ taskIds: assignTaskIds, goalId: createdGoal.id });
            toast.success(`Goal created with ${assignTaskIds.length} task${assignTaskIds.length > 1 ? "s" : ""}`);
            onAssigned?.();
          } catch {
            toast.error("Goal created, but moving the tasks failed");
          }
        } else {
          toast.success("Goal created");
        }
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message || "Failed to create goal"),
    });
  };

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button type="submit" form="goal-form" disabled={!name.trim() || isPending}>
        {goal ? "Save" : "Create"}
      </Button>
    </>
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? "Edit goal" : "New goal"}
      description={
        !goal && assignTaskIds.length
          ? `The ${assignTaskIds.length} selected task${assignTaskIds.length > 1 ? "s" : ""} will move into this goal.`
          : undefined
      }
      footer={footer}
    >
      <form id="goal-form" onSubmit={handleSubmit}>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="goal-name">Name</Label>
            <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-context">Shared context</Label>
            <Textarea
              id="goal-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="What every AI session on this goal's tasks should know (optional)"
              rows={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-epics">Jira epics</Label>
            <Input id="goal-epics" value={epics} onChange={(e) => setEpics(e.target.value)} placeholder="PS-123, PS-456 (optional)" />
            <p className="text-xs text-muted-foreground">Unassigned tasks in these epics join the goal when they sync.</p>
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
