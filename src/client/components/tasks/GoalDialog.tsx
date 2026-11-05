import { useState, useEffect } from "react";
import { useCreateGoal, useUpdateGoal } from "@/client/lib/queries/goals";
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
}

/** Create a goal, or edit one's name and shared context. */
export function GoalDialog({ open, onOpenChange, goal }: GoalDialogProps) {
  const [name, setName] = useState(goal?.name ?? "");
  const [context, setContext] = useState(goal?.context ?? "");
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const isPending = createGoal.isPending || updateGoal.isPending;

  // Reset the fields each time the dialog opens
  useEffect(() => {
    if (open) {
      setName(goal?.name ?? "");
      setContext(goal?.context ?? "");
    }
  }, [open, goal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const data = { name: trimmed, context: context.trim() || null };
    const options = {
      onSuccess: () => {
        toast.success(goal ? "Goal updated" : "Goal created");
        onOpenChange(false);
      },
      onError: () => toast.error(goal ? "Failed to update goal" : "Failed to create goal"),
    };
    if (goal) updateGoal.mutate({ id: goal.id, ...data }, options);
    else createGoal.mutate(data, options);
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
    <ModalDialog open={open} onOpenChange={onOpenChange} title={goal ? "Edit goal" : "New goal"} footer={footer}>
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
        </div>
      </form>
    </ModalDialog>
  );
}
