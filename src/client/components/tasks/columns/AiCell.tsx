import { useState } from "react";
import {
  Ban,
  CheckCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  Terminal,
  Unplug,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { ClaudeSession, ClaudeSessionState, Task } from "@/client/lib/types";
import { resolveChorePrompt, useChoreDefinitionsQuery, type ChoreEntry } from "@/client/lib/queries/chores";
import { useRespawnSession, useStopSession } from "@/client/lib/queries/sessions";
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
import { CustomPromptDialog, type PromptChore } from "../CustomPromptDialog";

export const ACTIVE_SESSION_STATES: ClaudeSessionState[] = ["queued", "preparing", "working", "blocked"];

export const STATE_UI: Record<ClaudeSessionState, { label: string; icon: typeof Loader2; className: string }> = {
  queued: { label: "Queued", icon: Clock, className: "text-muted-foreground" },
  preparing: { label: "Preparing", icon: Loader2, className: "text-muted-foreground animate-spin" },
  working: { label: "Working", icon: Loader2, className: "text-yellow-500 animate-spin" },
  blocked: { label: "Needs input", icon: MessageSquare, className: "text-yellow-500" },
  done: { label: "Done", icon: CheckCircle, className: "text-green-500" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-500" },
  stopped: { label: "Stopped", icon: Ban, className: "text-muted-foreground" },
};

export function isSessionActive(session: ClaudeSession | undefined): boolean {
  return !!session && ACTIVE_SESSION_STATES.includes(session.state);
}

/** The session's process is gone (reaped, stopped, or lost by the daemon) but its conversation is kept. */
export function canRespawn(session: ClaudeSession | undefined): boolean {
  return !!session?.shortId && !!session.processStoppedAt && !["queued", "preparing"].includes(session.state);
}

export const DISCONNECTED_UI = { label: "Disconnected", icon: Unplug, className: "text-red-500" };

/** States the column skips: the session is over and said nothing worth keeping. */
const SETTLED_STATES: ClaudeSessionState[] = ["done", "stopped"];

/** What the prompt dialog should open with: a chore's command, or a blank prompt. */
type PromptTarget = PromptChore | null;

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
  const stopSession = useStopSession();
  const respawnSession = useRespawnSession();
  // Both hold a PromptTarget, so `undefined` means "closed" and `null` means
  // "open with a blank prompt".
  const [promptTarget, setPromptTarget] = useState<PromptTarget | undefined>(undefined);
  const [repoTarget, setRepoTarget] = useState<PromptTarget | undefined>(undefined);

  const active = isSessionActive(session);
  // A settled session says nothing useful here; fall back to the idle /
  // next-chore label. Its links stay in the menu below, and the task's
  // Sessions section still shows every state.
  const shown = session && !SETTLED_STATES.includes(session.state) ? session : undefined;
  const ui = shown ? (active && canRespawn(shown) ? DISCONNECTED_UI : STATE_UI[shown.state]) : null;
  const Icon = ui?.icon ?? Sparkles;

  // Every start goes through the prompt dialog, so the command can be tweaked
  // and the model picked before the session spawns.
  const openPrompt = (target: PromptTarget) => {
    if (!task.repositoryId) {
      setRepoTarget(target);
      return;
    }
    setPromptTarget(target);
  };

  const startChore = (def: { number: number; key: string; name: string; prompt: string }) =>
    openPrompt({ number: def.number, key: def.key, name: def.name, prompt: resolveChorePrompt(def.prompt, task) });

  const stop = () => {
    if (!session) return;
    stopSession.mutate(session.id, {
      onSuccess: () => toast.success("Session stopped"),
      onError: () => toast.error("Failed to stop session"),
    });
  };

  const respawn = () => {
    if (!session) return;
    respawnSession.mutate(session.id, {
      onSuccess: () => toast.success("Session respawned"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to respawn session"),
    });
  };

  const copyAttach = () => {
    if (!session?.shortId) return;
    const cmd = `claude attach ${session.shortId}`;
    navigator.clipboard.writeText(cmd);
    toast.success(`Copied: ${cmd}`);
  };

  const idleNext = !shown && nextChore ? nextChore : null;

  const tooltip = shown
    ? [`${shown.choreName} · ${ui?.label}`, shown.needs ?? shown.detail ?? shown.error].filter(Boolean).join("\n")
    : idleNext
      ? `Next: #${idleNext.number} ${idleNext.name}\nClick to start`
      : "No AI session yet";

  const stateContent = (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium">
      <Icon
        className={cn("h-3.5 w-3.5 shrink-0", ui?.className ?? (idleNext ? "text-blue-500" : "text-muted-foreground/50"))}
      />
      <span className="truncate">{ui?.label ?? (idleNext ? `${idleNext.number}. ${idleNext.name}` : "AI")}</span>
    </span>
  );

  return (
    <>
      <div className="inline-flex items-stretch rounded overflow-hidden bg-muted text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            {shown?.link ? (
              <a
                href={shown.link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-accent hover:text-accent-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                {stateContent}
              </a>
            ) : idleNext ? (
              <button
                type="button"
                className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  startChore(idleNext);
                }}
              >
                {stateContent}
              </button>
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
                {canRespawn(session) && (
                  <DropdownMenuItem onClick={respawn} disabled={respawnSession.isPending}>
                    <RotateCcw className="h-3.5 w-3.5 mr-2" />
                    Respawn session
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
            <DropdownMenuItem disabled={active} onClick={() => openPrompt(null)}>
              <PenLine className="h-3.5 w-3.5 mr-2" />
              Custom prompt...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {active ? "Start (busy until the session ends)" : "Start a chore"}
            </DropdownMenuLabel>
            {nextChore && (
              <DropdownMenuItem disabled={active} onClick={() => startChore(nextChore)} className="font-medium">
                <Sparkles className="h-3.5 w-3.5 mr-2 text-blue-500" />
                Next: #{nextChore.number} {nextChore.name}
              </DropdownMenuItem>
            )}
            {definitions.map((def) => (
              <DropdownMenuItem key={def.key} disabled={active} onClick={() => startChore(def)}>
                <span className="text-muted-foreground mr-2">#{def.number}</span>
                {def.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CustomPromptDialog
        open={promptTarget !== undefined}
        onOpenChange={(open) => !open && setPromptTarget(undefined)}
        taskId={task.id}
        chore={promptTarget ?? null}
      />
      <RepoConfirmDialog
        open={repoTarget !== undefined}
        onOpenChange={(open) => !open && setRepoTarget(undefined)}
        taskId={task.id}
        onConfirmed={() => {
          setPromptTarget(repoTarget ?? null);
          setRepoTarget(undefined);
        }}
      />
    </>
  );
}
