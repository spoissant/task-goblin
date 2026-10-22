import { Link } from "react-router";
import { ExternalLink, RotateCcw } from "lucide-react";
import type { ClaudeSession, ClaudeSessionState } from "@/client/lib/types";
import { CopyChip } from "@/client/components/ui/copy-chip";
import { useRespawnSession } from "@/client/lib/queries/sessions";
import { STATE_UI, canRespawn, formatActive, formatCost, formatTime } from "@/client/lib/sessions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { cn } from "@/client/lib/utils";

type SessionRow = ClaudeSession & { taskTitle?: string | null };

/** A session's state as the AI column shows it: its icon, in the state's color, and label. */
function StateLabel({ state }: { state: ClaudeSessionState }) {
  const ui = STATE_UI[state];
  return (
    <span className="inline-flex items-center gap-1">
      <ui.icon className={cn("h-3.5 w-3.5 shrink-0", ui.className)} />
      {ui.label}
    </span>
  );
}

/** AI sessions table; `showTask` adds a column linking to each session's task. */
export function SessionsTable({ sessions, showTask = false }: { sessions: SessionRow[]; showTask?: boolean }) {
  const respawnSession = useRespawnSession();

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
              <TableCell className="text-sm font-medium whitespace-nowrap">
                <StateLabel state={s.state} />
              </TableCell>
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
                      onClick={() => respawnSession.mutate(s.id)}
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
