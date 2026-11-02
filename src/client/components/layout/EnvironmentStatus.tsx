import { Play, RefreshCw, Square } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { formatCountdown, useCountdown } from "@/client/lib/countdown";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import { ENVIRONMENTS_REFRESH_MS, useEnvironmentsQuery } from "@/client/lib/queries/environments";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import type { EnvSignal, EnvSignalLevel } from "@/shared/types";

const DOT: Record<EnvSignalLevel, string> = {
  ok: "bg-green-500",
  pending: "bg-blue-500",
  warn: "bg-yellow-500",
  broken: "bg-red-500",
  unknown: "bg-muted-foreground",
};

/** One signal: a dot (collapsed) or a dot and its label, linking to the Buildkite build. */
function Signal({ name, kind, signal, isCollapsed }: { name: string; kind: string; signal: EnvSignal; isCollapsed: boolean }) {
  const content = (
    <a
      href={signal.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground min-w-0"
    >
      <span className={cn("size-2 shrink-0 rounded-full", DOT[signal.level])} />
      {!isCollapsed && <span className="truncate">{signal.label}</span>}
    </a>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">
        <div className="font-medium">
          {name} {kind}: {signal.label}
        </div>
        {signal.detail && <div className="max-w-80">{signal.detail}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Play/stop for the polling, and a sync-now button counting down to the next poll. */
function RefreshControls({ autoRefresh, onToggle, isCollapsed }: { autoRefresh: boolean; onToggle: () => void; isCollapsed: boolean }) {
  const { dataUpdatedAt, errorUpdatedAt, isFetching, refetch } = useEnvironmentsQuery(autoRefresh);
  const lastFetch = Math.max(dataUpdatedAt, errorUpdatedAt);
  const nextAt = autoRefresh && lastFetch ? new Date(lastFetch + ENVIRONMENTS_REFRESH_MS).toISOString() : null;
  const untilNext = useCountdown(nextAt);

  return (
    <div className={cn("flex gap-1", isCollapsed && "flex-col")}>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onToggle}
        title={autoRefresh ? "Environment statuses refresh every 2 min. Click to stop" : "Environment statuses stopped. Click to start"}
        aria-label={autoRefresh ? "Stop environment refresh" : "Start environment refresh"}
      >
        {autoRefresh ? <Square /> : <Play />}
      </Button>
      <Button
        variant="outline"
        size={isCollapsed ? "icon-sm" : "sm"}
        disabled={isFetching}
        onClick={() => void refetch()}
        title={nextAt ? `Next refresh at ${new Date(nextAt).toLocaleTimeString()}` : "Auto refresh is off"}
        aria-label="Refresh environment statuses"
      >
        <RefreshCw className={cn(isFetching && "animate-spin")} />
        {!isCollapsed && (isFetching ? "Syncing…" : "Sync")}
        {!isCollapsed && !isFetching && untilNext !== null && (
          <span className="tabular-nums text-muted-foreground">{formatCountdown(untilNext)}</span>
        )}
      </Button>
    </div>
  );
}

/** Sidebar footer: per environment, is the branch head deployed and did the Playwright gate pass. */
export function EnvironmentStatus({ isCollapsed }: { isCollapsed: boolean }) {
  const [autoRefresh, setAutoRefresh] = useLocalStorage("environments-auto-refresh", true);
  const { data, error } = useEnvironmentsQuery(autoRefresh);
  const controls = <RefreshControls autoRefresh={autoRefresh} onToggle={() => setAutoRefresh((on) => !on)} isCollapsed={isCollapsed} />;

  if (error) {
    return (
      <div className={cn("space-y-3", isCollapsed && "flex flex-col items-center")}>
        {controls}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-red-500">{isCollapsed ? "!" : "Environments unavailable"}</span>
          </TooltipTrigger>
          <TooltipContent side="right">{error.message}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", isCollapsed && "flex flex-col items-center")}>
      {controls}
      {data?.items.map((env) => (
        <div key={env.name} className={cn("space-y-1", isCollapsed && "flex flex-col items-center")}>
          <div className="text-xs font-medium">{isCollapsed ? env.name.slice(0, 2) : env.name}</div>
          <Signal name={env.name} kind="deploy" signal={env.deploy} isCollapsed={isCollapsed} />
          <Signal name={env.name} kind="tests" signal={env.gate} isCollapsed={isCollapsed} />
        </div>
      ))}
    </div>
  );
}
