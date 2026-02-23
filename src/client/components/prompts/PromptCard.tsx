import { useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  useCancelPrompt,
  useRetryPrompt,
  useDeletePrompt,
  useUpdatePromptPosition,
  useUpdatePromptPermissionMode,
  usePromptQuery,
} from "@/client/lib/queries/prompts";
import {
  X,
  RotateCcw,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { AgentTerminal } from "@/client/components/agents/AgentTerminal";
import type { Prompt } from "@/client/lib/types";
import type { OutputMessage } from "@/client/lib/usePromptOutput";
import { toast } from "sonner";

const PERMISSION_LABELS: Record<string, string> = {
  default: "Default",
  plan: "Plan",
  acceptEdits: "Accept Edits",
  bypassPermissions: "Bypass",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-500",
  running: "bg-blue-500",
  done: "bg-green-500",
  need_input: "bg-amber-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-400",
  timeout: "bg-orange-500",
};

interface PromptCardProps {
  prompt: Prompt;
  isFirst: boolean;
  isLast: boolean;
}

export function PromptCard({ prompt, isFirst, isLast }: PromptCardProps) {
  const cancelPrompt = useCancelPrompt();
  const retryPrompt = useRetryPrompt();
  const deletePrompt = useDeletePrompt();
  const updatePosition = useUpdatePromptPosition();
  const updatePermission = useUpdatePromptPermissionMode();
  const [expanded, setExpanded] = useState(false);

  const isTerminal = ["done", "failed", "cancelled", "timeout"].includes(prompt.status);

  // Fetch full prompt (with messages) only when expanded + terminal
  const { data: fullPrompt } = usePromptQuery(prompt.id, expanded && isTerminal);
  const terminalMessages: OutputMessage[] = (() => {
    if (!fullPrompt?.messages) return [];
    try { return JSON.parse(fullPrompt.messages); } catch { return []; }
  })();

  const canCancel = prompt.status === "pending" || prompt.status === "running" || prompt.status === "need_input";
  const canRetry = ["failed", "timeout", "cancelled"].includes(prompt.status);
  const canDelete = prompt.status !== "running";
  const canReorder = prompt.status === "pending";
  const canEditPermission = prompt.status === "pending" || prompt.status === "need_input";

  const handleMoveUp = () => {
    updatePosition.mutate(
      { id: prompt.id, position: (prompt.position ?? 0) - 1 },
      { onError: () => toast.error("Failed to reorder") }
    );
  };

  const handleMoveDown = () => {
    updatePosition.mutate(
      { id: prompt.id, position: (prompt.position ?? 0) + 1 },
      { onError: () => toast.error("Failed to reorder") }
    );
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  };

  return (
    <div className="border rounded-md p-2.5 bg-card space-y-1.5">
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{prompt.content}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 gap-1"
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[prompt.status] || "bg-gray-400"}`}
              />
              {prompt.status}
            </Badge>
            {canEditPermission ? (
              <Select
                value={prompt.permissionMode}
                onValueChange={(val) =>
                  updatePermission.mutate(
                    { id: prompt.id, permissionMode: val },
                    { onError: () => toast.error("Failed to update permission mode") }
                  )
                }
              >
                <SelectTrigger className="h-5 text-[10px] px-1.5 py-0 w-auto gap-1 border-dashed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="acceptEdits">Accept Edits</SelectItem>
                  <SelectItem value="bypassPermissions">Bypass Permissions</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {PERMISSION_LABELS[prompt.permissionMode] || prompt.permissionMode}
              </Badge>
            )}
            {prompt.costUsd && (
              <span className="text-[10px] text-muted-foreground">
                ${Number(prompt.costUsd).toFixed(4)}
              </span>
            )}
            {prompt.durationMs != null && (
              <span className="text-[10px] text-muted-foreground">
                {formatDuration(prompt.durationMs)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canReorder && !isFirst && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleMoveUp}>
              <ChevronUp className="h-3 w-3" />
            </Button>
          )}
          {canReorder && !isLast && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleMoveDown}>
              <ChevronDown className="h-3 w-3" />
            </Button>
          )}
          {canCancel && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => cancelPrompt.mutate(prompt.id, { onError: () => toast.error("Failed to cancel") })}
              disabled={cancelPrompt.isPending}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          {canRetry && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => retryPrompt.mutate(prompt.id, { onError: () => toast.error("Failed to retry") })}
              disabled={retryPrompt.isPending}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => deletePrompt.mutate(prompt.id, { onError: () => toast.error("Failed to delete") })}
              disabled={deletePrompt.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="ml-5 space-y-1.5">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words bg-muted/50 rounded p-2 max-h-40 overflow-y-auto">
            {prompt.content}
          </pre>
          {prompt.output && (
            <div>
              <span className="text-[10px] text-muted-foreground font-medium">Output:</span>
              <pre className="text-xs whitespace-pre-wrap break-words bg-muted/50 rounded p-2 max-h-40 overflow-y-auto mt-0.5">
                {prompt.output}
              </pre>
            </div>
          )}
          {(prompt.errorMessage || prompt.status === "failed") && (
            <div>
              <span className="text-[10px] text-red-400 font-medium">Error:</span>
              <pre className="text-xs text-red-400 whitespace-pre-wrap break-words bg-red-950/20 rounded p-2 mt-0.5">
                {prompt.errorMessage || "Unknown error"}
              </pre>
            </div>
          )}
          {prompt.stderr && (
            <details>
              <summary className="text-[10px] text-orange-400 font-medium cursor-pointer">Stderr</summary>
              <pre className="text-xs text-orange-400 whitespace-pre-wrap break-words bg-orange-950/20 rounded p-2 mt-0.5 max-h-40 overflow-y-auto">
                {prompt.stderr}
              </pre>
            </details>
          )}
          {isTerminal && terminalMessages.length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground font-medium">Terminal:</span>
              <div className="mt-0.5 max-h-60 overflow-y-auto">
                <AgentTerminal messages={terminalMessages} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
