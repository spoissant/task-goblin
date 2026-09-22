import { useState } from "react";
import {
  Ban,
  CheckCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Sparkles,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { ClaudeSession, ClaudeSessionState, Task } from "@/client/lib/types";
import { ApiError } from "@/client/lib/api";
import { useChoreDefinitionsQuery, type ChoreEntry } from "@/client/lib/queries/chores";
import { useStartSession, useStopSession } from "@/client/lib/queries/sessions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { RepoConfirmDialog } from "../RepoConfirmDialog";

export const ACTIVE_SESSION_STATES: ClaudeSessionState[] = ["queued", "preparing", "working", "blocked"];

const STATE_UI: Record<ClaudeSessionState, { label: string; icon: typeof Loader2; className: string }> = {
  queued: { label: "Queued", icon: Clock, className: "text-muted-foreground" },
  preparing: { label: "Preparing", icon: Loader2, className: "text-muted-foreground animate-spin" },
  working: { label: "Working", icon: Loader2, className: "text-blue-500 animate-spin" },
  blocked: { label: "Needs input", icon: MessageSquare, className: "text-yellow-500" },
  done: { label: "Done", icon: CheckCircle, className: "text-green-500" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-500" },
  stopped: { label: "Stopped", icon: Ban, className: "text-muted-foreground" },
};

export function isSessionActive(session: ClaudeSession | undefined): boolean {
  return !!session && ACTIVE_SESSION_STATES.includes(session.state);
}

function startErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : "Failed to start session";
}

interface AiCellProps {
  task: Task;
  session?: ClaudeSession;
  nextChore?: ChoreEntry;
}

/**
 * AI column: state of the task's latest background Claude session with a
 * link to claude.ai, and a menu to start a chore, stop, or copy the attach
 * command. Mirrors the Chores cell layout.
 */
export function AiCell({ task, session, nextChore }: AiCellProps) {
  const { data: defsData } = useChoreDefinitionsQuery();
  const definitions = defsData?.items ?? [];
  const startSession = useStartSession();
  const stopSession = useStopSession();
  const [pendingChoreKey, setPendingChoreKey] = useState<string | null>(null);

  const active = isSessionActive(session);
  const ui = session ? STATE_UI[session.state] : null;
  const Icon = ui?.icon ?? Sparkles;

  const start = (choreKey: string) => {
    if (!task.repositoryId) {
      setPendingChoreKey(choreKey);
      return;
    }
    startSession.mutate(
      { taskId: task.id, choreKey },
      {
        onSuccess: (row) => toast.success(`Started ${row.choreName}`),
        onError: (err) => toast.error(startErrorMessage(err)),
      },
    );
  };

  const stop = () => {
    if (!session) return;
    stopSession.mutate(session.id, {
      onSuccess: () => toast.success("Session stopped"),
      onError: () => toast.error("Failed to stop session"),
    });
  };

  const copyAttach = () => {
    if (!session?.shortId) return;
    const cmd = `claude attach ${session.shortId}`;
    navigator.clipboard.writeText(cmd);
    toast.success(`Copied: ${cmd}`);
  };

  const tooltip = session
    ? [`${session.choreName} · ${ui?.label}`, session.needs ?? session.detail ?? session.error].filter(Boolean).join("\n")
    : "No AI session yet";

  const stateContent = (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium">
      <Icon className={cn("h-3.5 w-3.5", ui?.className ?? "text-muted-foreground/50")} />
      {ui?.label ?? "AI"}
    </span>
  );

  return (
    <>
      <div className="inline-flex items-stretch rounded overflow-hidden bg-muted text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            {session?.link ? (
              <a
                href={session.link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-accent hover:text-accent-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                {stateContent}
              </a>
            ) : (
              stateContent
            )}
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-line">{tooltip}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="AI session actions"
              className="px-1 py-0.5 cursor-pointer hover:bg-accent hover:text-accent-foreground border-l border-background/40"
              onClick={(e) => e.stopPropagation()}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto w-64">
            {session && (
              <>
                {session.link && (
                  <DropdownMenuItem asChild>
                    <a href={session.link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 mr-2" />
                      Open on claude.ai
                    </a>
                  </DropdownMenuItem>
                )}
                {session.shortId && (
                  <DropdownMenuItem onClick={copyAttach}>
                    <Terminal className="h-3.5 w-3.5 mr-2" />
                    Copy <span className="font-mono ml-1">claude attach {session.shortId}</span>
                  </DropdownMenuItem>
                )}
                {active && (
                  <DropdownMenuItem onClick={stop} disabled={stopSession.isPending}>
                    <Square className="h-3.5 w-3.5 mr-2" />
                    Stop session
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {active ? "Start (busy until the session ends)" : "Start a chore"}
            </DropdownMenuLabel>
            {nextChore && (
              <DropdownMenuItem disabled={active} onClick={() => start(nextChore.key)} className="font-medium">
                <Sparkles className="h-3.5 w-3.5 mr-2 text-blue-500" />
                Next: #{nextChore.number} {nextChore.name}
              </DropdownMenuItem>
            )}
            {definitions.map((def) => (
              <DropdownMenuItem key={def.key} disabled={active} onClick={() => start(def.key)}>
                <span className="text-muted-foreground mr-2">#{def.number}</span>
                {def.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <RepoConfirmDialog
        open={pendingChoreKey !== null}
        onOpenChange={(open) => !open && setPendingChoreKey(null)}
        taskId={task.id}
        onConfirmed={() => {
          const key = pendingChoreKey;
          setPendingChoreKey(null);
          if (key) {
            startSession.mutate(
              { taskId: task.id, choreKey: key },
              {
                onSuccess: (row) => toast.success(`Started ${row.choreName}`),
                onError: (err) => toast.error(startErrorMessage(err)),
              },
            );
          }
        }}
      />
    </>
  );
}
