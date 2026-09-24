import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SESSION_EFFORTS, SESSION_MODELS, type SessionEffort, type SessionModel } from "@/client/lib/types";
import { ApiError } from "@/client/lib/api";
import { useStartSession } from "@/client/lib/queries/sessions";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

const MODEL_LABELS: Record<SessionModel, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  fable: "Fable",
  haiku: "Haiku",
};

const EFFORT_LABELS: Record<SessionEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** A chore to pre-fill the dialog with, with its command already resolved. */
export interface PromptChore {
  number: number;
  key: string;
  name: string;
  prompt: string;
}

interface CustomPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  /** Pre-fills the chore's command; the session is still recorded as that chore. */
  chore?: PromptChore | null;
}

/**
 * Start a background session on a task. Opens blank for an ad-hoc prompt, or
 * pre-filled with a chore's command so it can be tweaked before it runs.
 */
export function CustomPromptDialog({ open, onOpenChange, taskId, chore }: CustomPromptDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<SessionModel>("opus");
  const [effort, setEffort] = useState<SessionEffort>("medium");
  const startSession = useStartSession();
  const chorePrompt = chore?.prompt ?? null;

  // Keyed on the chore's fields, not the object, so typing is never wiped.
  useEffect(() => {
    if (open) setPrompt(chorePrompt ? `${chorePrompt}\n` : "");
  }, [open, chorePrompt]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    startSession.mutate(
      { taskId, prompt: prompt.trim(), model, effort, choreKey: chore?.key },
      {
        onSuccess: (row) => {
          toast.success(`Started ${row.choreName}`);
          setPrompt("");
          onOpenChange(false);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError || err instanceof Error ? err.message : "Failed to start session"),
      },
    );
  };

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button type="submit" form="custom-prompt-form" disabled={!prompt.trim() || startSession.isPending}>
        {startSession.isPending ? "Starting..." : "Start session"}
      </Button>
    </>
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title={chore ? `#${chore.number} ${chore.name}` : "Custom prompt"}
      description={
        chore
          ? "Add context or change the model before the chore runs in the task's worktree."
          : "Runs in the task's worktree as a background Claude session."
      }
      footer={footer}
    >
      <form id="custom-prompt-form" onSubmit={submit}>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="custom-prompt-model">Model</Label>
              <Select value={model} onValueChange={(v) => setModel(v as SessionModel)}>
                <SelectTrigger id="custom-prompt-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODEL_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-prompt-effort">Effort</Label>
              <Select value={effort} onValueChange={(v) => setEffort(v as SessionEffort)}>
                <SelectTrigger id="custom-prompt-effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_EFFORTS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {EFFORT_LABELS[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-prompt">Prompt</Label>
            <Textarea
              id="custom-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should Claude do on this task?"
              rows={6}
              autoFocus
            />
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
