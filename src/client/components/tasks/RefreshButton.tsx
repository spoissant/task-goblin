import { useSyncJira, useSyncGitHub } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function RefreshButton() {
  const syncJira = useSyncJira();
  const syncGitHub = useSyncGitHub();

  const isLoading = syncJira.isPending || syncGitHub.isPending;

  const handleSyncJira = () => {
    syncJira.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`Jira sync: ${result.created ?? 0} created, ${result.updated ?? 0} updated`);
      },
      onError: (error) => {
        toast.error(`Jira sync failed: ${error.message}`);
      },
    });
  };

  const handleSyncGitHub = () => {
    syncGitHub.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`GitHub sync: ${result.created ?? 0} created, ${result.updated ?? 0} updated`);
      },
      onError: (error) => {
        toast.error(`GitHub sync failed: ${error.message}`);
      },
    });
  };

  const handleSyncAll = () => {
    handleSyncJira();
    handleSyncGitHub();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Sync
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
