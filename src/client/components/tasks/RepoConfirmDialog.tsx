import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useRepositoriesQuery, useUpdateTask } from "@/client/lib/queries";
import { useRepositoryGuessQuery } from "@/client/lib/queries/worktrees";
import { cn } from "@/client/lib/utils";
import { RepoBadge } from "./RepoBadge";

interface RepoConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  /** Called once the repository is saved on the task. */
  onConfirmed: (repositoryId: number) => void;
}

const GUESS_LABEL: Record<string, string> = {
  "title-keyword": "guessed from the title",
  "jira-project": "guessed from this Jira project's history",
  "only-enabled-repo": "the only enabled repository",
};

/** Pick the repository of a task that has no PR yet, prefilled with a guess. */
export function RepoConfirmDialog({ open, onOpenChange, taskId, onConfirmed }: RepoConfirmDialogProps) {
  const { data: repos } = useRepositoriesQuery();
  const { data: guess, isLoading } = useRepositoryGuessQuery(taskId, open);
  const updateTask = useUpdateTask();
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (open) setSelected(guess?.repositoryId ?? null);
  }, [open, guess?.repositoryId]);

  const enabledRepos = (repos?.items ?? []).filter((r) => r.enabled === 1);

  const confirm = () => {
    if (selected === null) return;
    updateTask.mutate(
      { id: taskId, repositoryId: selected },
      {
        onSuccess: () => {
          onOpenChange(false);
          onConfirmed(selected);
        },
        onError: () => toast.error("Failed to set repository"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Which repository?</DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Looking for a hint…"
              : guess?.reason
                ? `Prefilled: ${GUESS_LABEL[guess.reason] ?? guess.reason}. Confirm or pick another.`
                : "No hint available. Pick the repository this task lives in."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 py-2">
          {enabledRepos.map((repo) => (
            <button
              key={repo.id}
              type="button"
              onClick={() => setSelected(repo.id)}
              className={cn(
                "rounded-full ring-offset-background transition",
                selected === repo.id ? "ring-2 ring-primary ring-offset-2" : "opacity-70 hover:opacity-100",
              )}
            >
              <RepoBadge repo={repo} />
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={selected === null || updateTask.isPending}>
            Use this repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
