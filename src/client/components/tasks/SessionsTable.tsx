import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import type { ClaudeSession, ClaudeSessionState } from "@/client/lib/types";
import { CopyChip } from "@/client/components/ui/copy-chip";
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

type SessionRow = ClaudeSession & { taskTitle?: string };

/** AI sessions table; `showTask` adds a column linking to each session's task. */
export function SessionsTable({ sessions, showTask = false }: { sessions: SessionRow[]; showTask?: boolean }) {
  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            {showTask && <TableHead>Task</TableHead>}
            <TableHead>Chore</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(s.createdAt)}</TableCell>
              {showTask && (
                <TableCell className="text-sm max-w-xs truncate" title={s.taskTitle}>
                  <Link to={`/tasks/${s.taskId}`} className="hover:underline">
                    {s.taskTitle ?? `#${s.taskId}`}
                  </Link>
                </TableCell>
              )}
              <TableCell className="text-sm">{s.choreName}</TableCell>
              <TableCell className={cn("text-sm font-medium", STATE_CLASS[s.state])}>{s.state}</TableCell>
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
