import { useNextSyncQuery, useSyncAll } from "@/client/lib/queries/sync";
import { formatCountdown, useCountdown } from "@/client/lib/countdown";
import { ApiError } from "@/client/lib/api";
import { Button } from "@/client/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
