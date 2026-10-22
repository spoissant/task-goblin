import { useState, useMemo, useEffect } from "react";
import { useNextSyncQuery, useSyncAll, type SyncStep } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

const stepLabels: Record<SyncStep, string> = {
  jira: "Jira...",
  github: "GitHub...",
  matching: "matching...",
};

const stepNames: Record<SyncStep, string> = {
  jira: "Jira",
  github: "GitHub",
  matching: "Matching",
};

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
  const [syncStep, setSyncStep] = useState<SyncStep | null>(null);
  const nextSyncAt = useNextSyncQuery().data?.nextSyncAt ?? null;
  const untilNextSync = useCountdown(nextSyncAt);

  const syncOptions = useMemo(() => ({ onStepChange: setSyncStep }), []);

  const syncAll = useSyncAll(syncOptions);

  const isLoading = syncAll.isPending;

  const handleSyncAll = () => {
    syncAll.mutate(undefined, {
      onSuccess: (results) => {
        const parts: string[] = [];
        const jiraUnchanged = results.jira?.unchanged ?? 0;
        const jiraNew = results.jira?.new ?? 0;
        const jiraUpdated = results.jira?.updated ?? 0;
        const ghUnchanged = results.github?.unchanged ?? 0;
        const ghNew = results.github?.new ?? 0;
        const ghUpdated = results.github?.updated ?? 0;
        const merged = results.merged ?? 0;

        const totalUnchanged = jiraUnchanged + ghUnchanged;
        const totalNew = jiraNew + ghNew;
        const totalUpdated = jiraUpdated + ghUpdated;

        if (totalUnchanged > 0) parts.push(`${totalUnchanged} unchanged`);
        if (totalNew > 0) parts.push(`${totalNew} created`);
        if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);
        if (merged > 0) parts.push(`${merged} auto-merged`);

        if (parts.length === 0) {
          toast.success("Synced. No changes.");
        } else {
          toast.success(`Synced. ${parts.join(", ")}.`);
        }

        for (const failure of results.failures) {
          toast.error(`${stepNames[failure.step]} sync failed: ${failure.message}`);
        }
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Sync failed");
      },
    });
  };

  const buttonLabel = syncStep ? stepLabels[syncStep] : "Sync";

  return (
    <Button
      variant="outline"
      disabled={isLoading}
      onClick={handleSyncAll}
      title={nextSyncAt ? `Next auto sync at ${new Date(nextSyncAt).toLocaleTimeString()}` : "Auto sync is off"}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
      {buttonLabel}
      {!syncStep && untilNextSync !== null && (
        <span className="ml-2 tabular-nums text-muted-foreground">{formatCountdown(untilNextSync)}</span>
      )}
    </Button>
  );
}
