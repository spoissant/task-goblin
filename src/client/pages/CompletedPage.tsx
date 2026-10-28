import { useState, useEffect } from "react";
import { useCompletedTasksQuery } from "@/client/lib/queries/tasks";
import { useSyncVisibleTasks, type SyncVisibleProgress } from "@/client/lib/queries/sync";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { getPrUrl } from "@/client/lib/links";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { FilterToggle } from "@/client/components/ui/filter-toggle";
import { Pagination } from "@/client/components/ui/pagination";
import { Table, TableBody, TableHeader, TableRow } from "@/client/components/ui/table";
import { Input } from "@/client/components/ui/input";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/ui/empty-state";
import { COMPLETED_COLUMNS, ColumnCells, ColumnHeads } from "@/client/components/tasks/columns";

const PAGE_SIZE = 25;

export function CompletedPage() {
  const [page, setPage] = useState(0);
  const [hideDone, setHideDone] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [syncProgress, setSyncProgress] = useState<SyncVisibleProgress | null>(null);
  const syncVisible = useSyncVisibleTasks();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, error } = useCompletedTasksQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    showDone: !hideDone,
    title: debouncedQuery,
  });
  const { data: settingsData } = useSettingsQuery();

  const jiraHost = settingsData?.jira_host || null;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const handleSyncVisible = () => {
    const syncable = (data?.items ?? []).filter((t) => t.jiraKey || t.prNumber);
    if (!syncable.length) {
      toast.info("No syncable tasks on this page");
      return;
    }
    setSyncProgress({ current: 0, total: syncable.length });
    syncVisible.mutate(
      { tasks: syncable, onProgress: setSyncProgress },
      {
        onSuccess: ({ errors }) => {
          toast.success(`Synced ${syncable.length} task${syncable.length !== 1 ? "s" : ""}`);
          errors.forEach((e) => toast.error(e));
        },
        onError: () => toast.error("Sync failed"),
        onSettled: () => setSyncProgress(null),
      }
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Completed Tasks</h1>
        <div className="flex items-center gap-4">
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.total} completed task{data.total !== 1 ? "s" : ""}
            </span>
          )}
          <FilterToggle
            id="hide-done"
            label="Hide done"
            checked={hideDone}
            onCheckedChange={(checked) => {
              setHideDone(checked);
              setPage(0);
            }}
          />
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search completed tasks..."
          title="Combine with | (or) and & (and); prefix a term with ~ to exclude it (e.g. tiptap | editor & ~bug)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2 mb-6 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-amber-800 dark:text-amber-200 text-sm">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">
          Completed issues are NOT synced during the "Sync all" action. Use the sync button on individual rows if you need the latest state.
        </span>
        {data && data.items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            disabled={syncVisible.isPending}
            onClick={handleSyncVisible}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncVisible.isPending ? "animate-spin" : ""}`} />
            {syncVisible.isPending && syncProgress
              ? `${syncProgress.current}/${syncProgress.total}`
              : "Sync visible"}
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {error && <EmptyState message="Failed to load completed tasks" />}

      {data && !data.items.length && <EmptyState message="No completed tasks found" />}

      {data && data.items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <ColumnHeads columns={COMPLETED_COLUMNS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((task) => (
                <TableRow key={task.id}>
                  <ColumnCells
                    task={task}
                    columns={COMPLETED_COLUMNS}
                    context={{
                      repo: task.repository,
                      jiraHost,
                      prUrl: getPrUrl(task.repository, task.prNumber),
                      linkToTask: true,
                      completed: true,
                    }}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            className="mt-6"
          />
        </>
      )}
    </div>
  );
}
