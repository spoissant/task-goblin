// How the client shows AI sessions: state labels and icons, whether a session
// is still running or can be respawned, and its usage figures.
import { Ban, CheckCircle, Clock, Loader2, MessageSquare, Unplug, XCircle } from "lucide-react";
import { ACTIVE_SESSION_STATES, type ClaudeSession, type ClaudeSessionState } from "@/shared/types";

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

export function formatTime(iso: string): string {
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
