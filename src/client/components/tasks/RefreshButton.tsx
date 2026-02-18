import { useState, useMemo } from "react";
import { useSyncAll, type SyncStep } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

const stepLabels: Record<SyncStep, string> = {
  jira: "Jira...",
  github: "GitHub...",
  matching: "matching...",
};

export function RefreshButton() {
  const [syncStep, setSyncStep] = useState<SyncStep | null>(null);

  const syncOptions = useMemo(() => ({ onStepChange: setSyncStep }), []);

  const syncAll = useSyncAll(syncOptions);

  const isLoading = syncAll.isPending;

  const handleSyncAll = () => {
    syncAll.mutate(undefined, {
      onSuccess: (results) => {
        const parts: string[] = [];
        const jiraUnchanged = results.jira?.unchanged ?? 0;
        const jiraCreated = results.jira?.created ?? 0;
        const jiraUpdated = results.jira?.updated ?? 0;
        const ghUnchanged = results.github?.unchanged ?? 0;
        const ghCreated = results.github?.created ?? 0;
        const ghUpdated = results.github?.updated ?? 0;
        const merged = results.merged ?? 0;

        const totalUnchanged = jiraUnchanged + ghUnchanged;
        const totalCreated = jiraCreated + ghCreated;
        const totalUpdated = jiraUpdated + ghUpdated;

        if (totalUnchanged > 0) parts.push(`${totalUnchanged} unchanged`);
        if (totalCreated > 0) parts.push(`${totalCreated} created`);
        if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);
        if (merged > 0) parts.push(`${merged} auto-merged`);

        if (parts.length === 0) {
          toast.success("Synced. No changes.");
        } else {
          toast.success(`Synced. ${parts.join(", ")}.`);
        }
      },
      onError: () => {
        toast.error("Sync failed");
      },
    });
  };

  const buttonLabel = syncStep ? stepLabels[syncStep] : "Sync";

  return (
    <Button variant="outline" disabled={isLoading} onClick={handleSyncAll}>
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
      {buttonLabel}
    </Button>
  );
}
