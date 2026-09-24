import { CheckCircle, PencilLine, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ClaudeSession } from "@/client/lib/types";
import { useRespawnSession, useStartReviewSession, type StartReviewInput } from "@/client/lib/queries/sessions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { DISCONNECTED_UI, STATE_UI, canRespawn, isSessionActive } from "../tasks/columns/AiCell";

interface ReviewCellProps {
  /** Latest review session for this PR, if any. */
  session?: ClaudeSession;
  /** What the AI button starts; null disables it with `disabledReason`. */
  start: StartReviewInput | null;
  disabledReason?: string;
  /** You have an unsubmitted draft review on the PR (others' PRs only). */
  hasDraft: boolean;
  prUrl: string;
}

const PILL = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium";
const IDLE_PILL = `${PILL} bg-muted text-muted-foreground`;
const HOVER = "cursor-pointer hover:bg-accent hover:text-accent-foreground";
const DRAFT_PILL = `${PILL} border border-violet-400 bg-violet-100 text-violet-900 hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-100 dark:border-violet-500`;

/**
 * Review column: an AI button that starts a background code review, the
 * session's state while it runs, then the draft review it posted. Every state
 * with a session opens it on claude.ai, to follow up with questions.
 */
export function ReviewCell({ session, start, disabledReason, hasDraft, prUrl }: ReviewCellProps) {
  const startReview = useStartReviewSession();
  const respawnSession = useRespawnSession();

  const run = () => {
    if (!start) return;
    startReview.mutate(start, {
      onSuccess: () => toast.success("Code review started"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start the review"),
    });
  };

  const respawn = () => {
    if (!session) return;
    respawnSession.mutate(session.id, {
      onSuccess: () => toast.success("Session respawned"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to respawn session"),
    });
  };

  const link = (label: React.ReactNode, className: string, href: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  );

  let content: React.ReactNode;
  let tooltip: string;

  if (session && isSessionActive(session)) {
    const disconnected = canRespawn(session);
    const ui = disconnected ? DISCONNECTED_UI : STATE_UI[session.state];
    const label = (
      <>
        <ui.icon className={cn("h-3.5 w-3.5 shrink-0", ui.className)} />
        {ui.label}
      </>
    );
    tooltip = [disconnected ? "Process lost: click to respawn" : ui.label, session.needs ?? session.detail]
      .filter(Boolean)
      .join("\n");
    content = disconnected ? (
      <button type="button" className={cn(IDLE_PILL, HOVER)} onClick={respawn} disabled={respawnSession.isPending}>
        {label}
      </button>
    ) : session.link ? (
      link(label, cn(IDLE_PILL, HOVER), session.link)
    ) : (
      <span className={IDLE_PILL}>{label}</span>
    );
  } else if (hasDraft) {
    // No session means the draft was written elsewhere: open it on GitHub instead.
    tooltip = session?.link ? "Draft review posted: open the session" : "Unsubmitted draft review: open on GitHub";
    content = link(
      <>
        <PencilLine className="h-3 w-3" />
        Draft review
      </>,
      DRAFT_PILL,
      session?.link ?? `${prUrl}/files`,
    );
  } else if (session?.state === "failed") {
    tooltip = `${session.error ?? session.detail ?? "The review failed"}\nClick to retry`;
    content = (
      <button type="button" className={cn(IDLE_PILL, HOVER)} onClick={run} disabled={!start || startReview.isPending}>
        <XCircle className="h-3.5 w-3.5 text-red-500" />
        Retry
      </button>
    );
  } else if (session?.state === "done" && session.choreKey === "code-review-pr" && session.link) {
    // Own PRs: the review ends in local fixes, not a GitHub draft.
    tooltip = "Reviewed: open the session";
    content = (
      <span className="inline-flex items-center gap-1">
        {link(
          <>
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            Reviewed
          </>,
          cn(IDLE_PILL, HOVER),
          session.link,
        )}
        <button
          type="button"
          aria-label="Review again"
          className={cn(IDLE_PILL, HOVER, "px-1")}
          onClick={run}
          disabled={!start || startReview.isPending}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </span>
    );
  } else {
    tooltip = disabledReason ?? "Start an AI code review in the background";
    content = (
      <button
        type="button"
        className={cn(IDLE_PILL, start && HOVER, !start && "opacity-50")}
        onClick={run}
        disabled={!start || startReview.isPending}
      >
        <Sparkles className={cn("h-3.5 w-3.5", start ? "text-blue-500" : "text-muted-foreground/50")} />
        AI
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{content}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-line">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
