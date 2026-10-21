import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useChoreModelDefaults } from "@/client/lib/chore-models";
import { resolveChorePrompt, useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import { useRespawnSession, useStartReviewSession } from "@/client/lib/queries/sessions";
import type { PromptChore } from "@/client/components/tasks/CustomPromptDialog";
import type { InboxItem } from "@/shared/inbox";
import { InboxRow, SessionLinks, TaskLabel } from "./InboxSection";

type FailedItem = Extract<InboxItem, { kind: "failed" }>;

interface FailedSessionRowProps {
  item: FailedItem;
  /** Opens the prompt dialog on the task; `chore` null means a blank prompt. */
  onRetry: (taskId: number, chore: PromptChore | null) => void;
}

/** A failed session: its error, Retry (a fresh run of the same chore) and Respawn when its process can come back. */
export function FailedSessionRow({ item, onRetry }: FailedSessionRowProps) {
  const { session, task } = item;
  const { data: defs } = useChoreDefinitionsQuery();
  const { getDefault } = useChoreModelDefaults();
  const startReview = useStartReviewSession();
  const respawnSession = useRespawnSession();

  const retry = () => {
    if (task) {
      const def = defs?.items.find((d) => d.key === session.choreKey);
      onRetry(task.id, def ? { ...def, prompt: resolveChorePrompt(def.prompt, task) } : null);
      return;
    }
    if (!session.prUrl) return;
    startReview.mutate({ prUrl: session.prUrl, ...getDefault("review-pr") }, {
      onSuccess: () => toast.success("Code review started"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start the review"),
    });
  };

  const respawn = () =>
    respawnSession.mutate(session.id, {
      onSuccess: () => toast.success("Session respawned"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to respawn session"),
    });

  const actions = (
    <>
      <SessionLinks session={session} />
      {session.shortId && (
        <button
          type="button"
          onClick={respawn}
          disabled={respawnSession.isPending}
          title={`claude respawn ${session.shortId}`}
          className="inline-flex cursor-pointer items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          Respawn
        </button>
      )}
      {(task || session.prUrl) && (
        <Button size="sm" variant="outline" onClick={retry} disabled={startReview.isPending}>
          Retry
        </Button>
      )}
    </>
  );

  return (
    <InboxRow actions={actions}>
      {task ? <TaskLabel task={task} /> : <span className="font-medium">{session.name}</span>}
      <p className="text-xs text-muted-foreground">{session.choreName}</p>
      {(session.error ?? session.detail) && (
        <p className="whitespace-pre-wrap break-words text-sm text-red-600 dark:text-red-400">
          {session.error ?? session.detail}
        </p>
      )}
    </InboxRow>
  );
}
