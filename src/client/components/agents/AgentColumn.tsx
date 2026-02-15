import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Play, Square, Settings, Trash2, RefreshCw } from "lucide-react";
import {
  useStartAgent,
  useStopAgent,
  useDeleteAgent,
  useCheckAgent,
} from "@/client/lib/queries/agents";
import { useAgentPollCountdown } from "@/client/lib/useAgentPollCountdown";
import { usePromptsQuery } from "@/client/lib/queries/prompts";
import { usePromptOutput } from "@/client/lib/usePromptOutput";
import { AgentTerminal } from "./AgentTerminal";
import { ToolApprovalBanner } from "./ToolApprovalBanner";
import { EditAgentDialog } from "./EditAgentDialog";
import type { AgentWithWorktree } from "@/client/lib/types";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-500",
  running: "bg-blue-500",
  done: "bg-green-500",
  need_input: "bg-amber-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-400",
  timeout: "bg-orange-500",
};

interface AgentColumnProps {
  agent: AgentWithWorktree;
}

export function AgentColumn({ agent }: AgentColumnProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [promptDetailOpen, setPromptDetailOpen] = useState(false);
  const [approvalExpanded, setApprovalExpanded] = useState(false);
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const deleteAgent = useDeleteAgent();
  const checkAgent = useCheckAgent();

  const { data: promptsData } = usePromptsQuery(
    agent.worktree.repository.id
  );

  // Find active prompt for this agent
  const activePrompt = promptsData?.items.find(
    (p) => p.agentId === agent.id && (p.status === "running" || p.status === "need_input")
  );

  const messages = usePromptOutput(activePrompt?.id ?? null, activePrompt?.status as any);

  const isRunning = agent.status === "running";
  const isIdlePolling = isRunning && !activePrompt;
  const { remainingMs } = useAgentPollCountdown(agent.id, isIdlePolling);
  const dotHex = agent.worktree.color || "#808080";

  const handleStart = () => {
    startAgent.mutate(agent.id, {
      onError: () => toast.error("Failed to start agent"),
    });
  };

  const handleStop = () => {
    stopAgent.mutate(agent.id, {
      onError: () => toast.error("Failed to stop agent"),
    });
  };

  const handleDelete = () => {
    if (confirm(`Delete agent "${agent.name}"?`)) {
      deleteAgent.mutate(agent.id, {
        onError: () => toast.error("Failed to delete agent"),
      });
    }
  };

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotHex }} />
          <span className="font-medium text-sm truncate">{agent.name}</span>
          <span className="text-xs text-muted-foreground truncate">
            {agent.worktree.repository.owner}/{agent.worktree.repository.repo}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isRunning ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleStop}
              disabled={stopAgent.isPending}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleStart}
              disabled={startAgent.isPending}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setEditOpen(true)}
            disabled={isRunning}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleDelete}
            disabled={isRunning}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 bg-muted/20 border-b text-xs text-muted-foreground">
        {(() => {
          if (agent.status === "idle") {
            return `${new Date(agent.updatedAt).toLocaleString()}: Stopped`;
          }
          if (!activePrompt) {
            const remainingSec = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;
            const progress = remainingMs != null ? 1 - remainingMs / 2000 : 0;
            return (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="truncate">
                      {remainingSec != null
                        ? `Checking in ${remainingSec}s`
                        : "Waiting to poll..."}
                    </span>
                  </div>
                  <div className="h-0.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500/50 transition-all duration-100"
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[11px] flex-shrink-0"
                  onClick={() => checkAgent.mutate(agent.id)}
                  disabled={checkAgent.isPending}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${checkAgent.isPending ? "animate-spin" : ""}`} />
                  Check now
                </Button>
              </div>
            );
          }
          const date = new Date(activePrompt.updatedAt).toLocaleString();
          const promptLink = (
            <button
              className="underline hover:text-foreground"
              onClick={() => setPromptDetailOpen(true)}
            >
              #{activePrompt.id}
            </button>
          );
          if (activePrompt.status === "running") {
            const suffix = activePrompt.taskId ? ` for task #${activePrompt.taskId}` : "";
            return <>{date}: Processing prompt {promptLink}{suffix}</>;
          }
          if (activePrompt.status === "need_input") {
            return <>{date}: Awaiting tool approval on prompt {promptLink}</>;
          }
          return `${new Date(agent.updatedAt).toLocaleString()}: ${agent.status}`;
        })()}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 p-2 gap-2 overflow-y-auto">
        {activePrompt?.status === "need_input" && (
          <ToolApprovalBanner
            prompt={activePrompt}
            expanded={approvalExpanded}
            onToggleExpand={() => setApprovalExpanded((v) => !v)}
            onRespond={() => setApprovalExpanded(false)}
          />
        )}
        {!approvalExpanded && <AgentTerminal messages={messages} />}
      </div>

      <EditAgentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        agent={agent}
      />

      {activePrompt && (
        <ModalDialog
          open={promptDetailOpen}
          onOpenChange={setPromptDetailOpen}
          title={`Prompt #${activePrompt.id}`}
          size="lg"
        >
          <div className="space-y-4 pb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs px-2 py-0.5 gap-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[activePrompt.status] || "bg-gray-400"}`} />
                {activePrompt.status}
              </Badge>
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                {activePrompt.permissionMode}
              </Badge>
              {activePrompt.taskId && (
                <span className="text-xs text-muted-foreground">Task #{activePrompt.taskId}</span>
              )}
              {activePrompt.costUsd && (
                <span className="text-xs text-muted-foreground">${Number(activePrompt.costUsd).toFixed(4)}</span>
              )}
              {activePrompt.durationMs != null && (
                <span className="text-xs text-muted-foreground">
                  {activePrompt.durationMs < 1000
                    ? `${activePrompt.durationMs}ms`
                    : activePrompt.durationMs < 60_000
                      ? `${(activePrompt.durationMs / 1000).toFixed(1)}s`
                      : `${(activePrompt.durationMs / 60_000).toFixed(1)}m`}
                </span>
              )}
            </div>

            <div>
              <span className="text-xs font-medium text-muted-foreground">Content</span>
              <pre className="text-xs whitespace-pre-wrap break-words bg-muted/50 rounded p-2 mt-1 max-h-60 overflow-y-auto">
                {activePrompt.content}
              </pre>
            </div>

            {activePrompt.output && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Output</span>
                <pre className="text-xs whitespace-pre-wrap break-words bg-muted/50 rounded p-2 mt-1 max-h-60 overflow-y-auto">
                  {activePrompt.output}
                </pre>
              </div>
            )}

            {activePrompt.errorMessage && (
              <div>
                <span className="text-xs font-medium text-red-400">Error</span>
                <pre className="text-xs text-red-400 whitespace-pre-wrap break-words bg-red-950/20 rounded p-2 mt-1">
                  {activePrompt.errorMessage}
                </pre>
              </div>
            )}

            <div className="flex gap-4 text-[11px] text-muted-foreground">
              <span>Created: {new Date(activePrompt.createdAt).toLocaleString()}</span>
              {activePrompt.startedAt && <span>Started: {new Date(activePrompt.startedAt).toLocaleString()}</span>}
              {activePrompt.completedAt && <span>Completed: {new Date(activePrompt.completedAt).toLocaleString()}</span>}
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
