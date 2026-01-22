import { useState, useMemo } from "react";
import { useSyncJira, useSyncGitHub, useSyncAll, type SyncStep } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
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

  const syncJira = useSyncJira(syncOptions);
  const syncGitHub = useSyncGitHub(syncOptions);
  const syncAll = useSyncAll(syncOptions);

  const isLoading = syncJira.isPending || syncGitHub.isPending || syncAll.isPending;

  const handleSyncJira = () => {
    syncJira.mutate(undefined, {
      onSuccess: (result) => {
        const parts = [`${result.created ?? 0} created`, `${result.updated ?? 0} updated`];
        if (result.merged && result.merged > 0) {
          parts.push(`${result.merged} auto-merged`);
        }
        toast.success(`Jira sync: ${parts.join(", ")}`);
      },
      onError: (error) => {
        toast.error(`Jira sync failed: ${error.message}`);
      },
    });
  };

  const handleSyncGitHub = () => {
    syncGitHub.mutate(undefined, {
      onSuccess: (result) => {
        const parts = [`${result.created ?? 0} created`, `${result.updated ?? 0} updated`];
        if (result.merged && result.merged > 0) {
          parts.push(`${result.merged} auto-merged`);
        }
        toast.success(`GitHub sync: ${parts.join(", ")}`);
      },
      onError: (error) => {
        toast.error(`GitHub sync failed: ${error.message}`);
      },
    });
  };

  const handleSyncAll = () => {
    syncAll.mutate(undefined, {
      onSuccess: (results) => {
        const parts: string[] = [];
        const jiraCreated = results.jira?.created ?? 0;
        const jiraUpdated = results.jira?.updated ?? 0;
        const ghCreated = results.github?.created ?? 0;
        const ghUpdated = results.github?.updated ?? 0;
        const merged = results.merged ?? 0;

        const totalCreated = jiraCreated + ghCreated;
        const totalUpdated = jiraUpdated + ghUpdated;

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          {buttonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleSyncAll}>
          Sync All
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSyncJira}>
          Sync Jira
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSyncGitHub}>
          Sync GitHub
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
