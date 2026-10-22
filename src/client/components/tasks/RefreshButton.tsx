import { useState, useEffect } from "react";
import { useNextSyncQuery, useSyncAll } from "@/client/lib/queries";
import { ApiError } from "@/client/lib/api";
import { Button } from "@/client/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Milliseconds until `at`, ticking every second; null without a time. */
function useCountdown(at: string | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  return at ? Math.max(0, Date.parse(at) - now) : null;
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function RefreshButton() {
  const nextSyncAt = useNextSyncQuery().data?.nextSyncAt ?? null;
  const untilNextSync = useCountdown(nextSyncAt);
  const syncAll = useSyncAll();
  const isLoading = syncAll.isPending;

  const handleSyncAll = () => {
    syncAll.mutate(undefined, {
      onSuccess: ({ jira, github, errors }) => {
        const total = (key: "unchanged" | "new" | "updated") => (jira?.[key] ?? 0) + (github?.[key] ?? 0);
        const parts: string[] = [];
        if (total("unchanged") > 0) parts.push(`${total("unchanged")} unchanged`);
        if (total("new") > 0) parts.push(`${total("new")} created`);
        if (total("updated") > 0) parts.push(`${total("updated")} updated`);

        // No summary when neither source synced: the errors say why.
        if (jira || github) toast.success(parts.length ? `Synced. ${parts.join(", ")}.` : "Synced. No changes.");
        for (const { step, message } of errors) toast.error(`${step} step failed: ${message}`);
      },
      // A rejected fetch, not an ApiError, means the request never reached the
      // server at all, e.g. the backend process isn't running.
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reach the server"),
    });
  };

  return (
    <Button
      variant="outline"
      disabled={isLoading}
      onClick={handleSyncAll}
      title={nextSyncAt ? `Next auto sync at ${new Date(nextSyncAt).toLocaleTimeString()}` : "Auto sync is off"}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
      {isLoading ? "Syncing…" : "Sync"}
      {!isLoading && untilNextSync !== null && (
        <span className="ml-2 tabular-nums text-muted-foreground">{formatCountdown(untilNextSync)}</span>
      )}
    </Button>
  );
}
