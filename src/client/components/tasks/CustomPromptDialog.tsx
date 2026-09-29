import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SESSION_EFFORTS, SESSION_MODELS, type SessionEffort, type SessionModel } from "@/client/lib/types";
import { ApiError } from "@/client/lib/api";
import { handleResponse } from "@/shared/api";
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

/** Save a pasted image on the server; returns the file path to put in the prompt. */
async function uploadImage(file: File): Promise<string> {
  const response = await fetch("/api/v1/sessions/images", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  return (await handleResponse<{ path: string }>(response)).path;
}

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
  const [uploading, setUploading] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startSession = useStartSession();
  const chorePrompt = chore?.prompt ?? null;

  // Keyed on the chore's fields, not the object, so typing is never wiped.
  useEffect(() => {
    if (open) setPrompt(chorePrompt ? `${chorePrompt}\n` : "");
  }, [open, chorePrompt]);

  // Pasted screenshots are uploaded and replaced by their file path at the cursor.
  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    const { selectionStart, selectionEnd } = e.currentTarget;
    setUploading((n) => n + 1);
    try {
      const paths = await Promise.all(images.map(uploadImage));
      const text = paths.map((p) => `[Image: ${p}]`).join(" ");
      setPrompt((prev) => prev.slice(0, selectionStart) + text + prev.slice(selectionEnd));
      requestAnimationFrame(() => {
        const cursor = selectionStart + text.length;
        textareaRef.current?.setSelectionRange(cursor, cursor);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading((n) => n - 1);
    }
  };

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
      <Button type="submit" form="custom-prompt-form" disabled={!prompt.trim() || uploading > 0 || startSession.isPending}>
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
              ref={textareaRef}
              id="custom-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={onPaste}
              placeholder="What should Claude do on this task? Paste screenshots to attach them."
              rows={6}
              autoFocus
            />
            {uploading > 0 && <p className="text-xs text-muted-foreground">Uploading image...</p>}
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
