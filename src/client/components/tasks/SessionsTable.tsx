import { Link } from "react-router";
import { ExternalLink, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { ClaudeSession, ClaudeSessionState } from "@/client/lib/types";
import { CopyChip } from "@/client/components/ui/copy-chip";
import { useRespawnSession } from "@/client/lib/queries/sessions";
import { canRespawn } from "./columns/AiCell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { cn } from "@/client/lib/utils";

const STATE_CLASS: Record<ClaudeSessionState, string> = {
  queued: "text-muted-foreground",
  preparing: "text-muted-foreground",
  working: "text-blue-500",
  blocked: "text-yellow-600",
  done: "text-green-600",
  failed: "text-red-500",
  stopped: "text-muted-foreground",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatCost(usd: number | null): string {
  return usd === null ? "—" : `$${usd.toFixed(2)}`;
}

/** Active time, e.g. "45s", "21m", "1h 10m". */
export function formatActive(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes === 0) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type SessionRow = ClaudeSession & { taskTitle?: string | null };

/** AI sessions table; `showTask` adds a column linking to each session's task. */
export function SessionsTable({ sessions, showTask = false }: { sessions: SessionRow[]; showTask?: boolean }) {
  const respawnSession = useRespawnSession();
  const respawn = (id: number) =>
    respawnSession.mutate(id, {
      onSuccess: () => toast.success("Session respawned"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to respawn session"),
    });

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            {showTask && <TableHead>Task</TableHead>}
            <TableHead>Chore</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right" title="Time Claude spent working, summed over turns">Active</TableHead>
            <TableHead className="text-right">Subagents</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(s.createdAt)}</TableCell>
              {showTask && (
                <TableCell className="text-sm max-w-xs truncate" title={s.taskTitle ?? s.prUrl ?? undefined}>
                  {s.taskId !== null ? (
                    <Link to={`/tasks/${s.taskId}`} className="hover:underline">
                      {s.taskTitle ?? `#${s.taskId}`}
                    </Link>
                  ) : s.prUrl ? (
                    <a href={s.prUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {s.name}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}
              <TableCell className="text-sm">{s.choreName}</TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {s.model ?? "default"}
                {s.effort && ` · ${s.effort}`}
              </TableCell>
              <TableCell className={cn("text-sm font-medium", STATE_CLASS[s.state])}>{s.state}</TableCell>
              <TableCell className="text-sm text-right tabular-nums">{formatCost(s.costUsd)}</TableCell>
              <TableCell className="text-sm text-right tabular-nums" title={s.turnCount !== null ? `${s.turnCount} turns` : undefined}>
                {formatActive(s.activeMs)}
              </TableCell>
              <TableCell className="text-sm text-right tabular-nums">{s.subagentCount ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-md truncate" title={s.needs ?? s.detail ?? s.error ?? ""}>
                {s.needs ?? s.detail ?? s.error ?? s.result ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-3">
                  {s.link && (
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs"
                    >
                      <ExternalLink className="h-3 w-3" />
                      claude.ai
                    </a>
                  )}
                  {canRespawn(s) && (
                    <button
                      type="button"
                      onClick={() => respawn(s.id)}
                      disabled={respawnSession.isPending}
                      title={`claude respawn ${s.shortId}`}
                      className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Respawn
                    </button>
                  )}
                  {s.shortId && <CopyChip value={`claude attach ${s.shortId}`}>attach {s.shortId}</CopyChip>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
