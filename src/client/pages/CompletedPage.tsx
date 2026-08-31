import { useState, useEffect } from "react";
import { Link } from "react-router";
import { useCompletedTasksQuery, useSyncTask, useSyncVisibleTasks } from "@/client/lib/queries";
import type { SyncVisibleProgress, SyncTaskParams } from "@/client/lib/queries/sync";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { InteractiveStatusBadge } from "@/client/components/tasks/InteractiveStatusBadge";
import { ChecksStatusCell } from "@/client/components/tasks/ChecksStatusCell";
import { ReviewStatusIcon, PrStatusIcon } from "@/client/components/tasks/StatusIcons";
import { RepoBadge } from "@/client/components/tasks/RepoBadge";
import { Pagination } from "@/client/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Input } from "@/client/components/ui/input";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/ui/empty-state";
import { getJiraUrl, getPrUrl, ParentCell } from "@/client/components/tasks/columns/cells";
import type { TaskWithRepository } from "@/client/lib/types";

const PAGE_SIZE = 25;

export function CompletedPage() {
  const [page, setPage] = useState(0);
  const [showDone, setShowDone] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [syncProgress, setSyncProgress] = useState<SyncVisibleProgress | null>(null);
  const syncVisible = useSyncVisibleTasks();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, error } = useCompletedTasksQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    showDone,
    title: debouncedQuery,
  });
  const { data: settingsData } = useSettingsQuery();

  const jiraHost = settingsData?.jira_host || null;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

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
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={showDone}
              onCheckedChange={(checked) => {
                setShowDone(checked === true);
                setPage(0);
              }}
            />
            Show done
          </label>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search completed tasks..."
          title="Prefix with ~ to exclude matches (e.g. ~tiptap)"
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
            onClick={() => {
              const syncable: SyncTaskParams[] = data.items
                .filter((t) => t.jiraKey || t.prNumber)
                .map((t) => ({ task: t, repo: t.repository ?? undefined }));
              if (!syncable.length) {
                toast.info("No syncable tasks on this page");
                return;
              }
              setSyncProgress({ current: 0, total: syncable.length });
              syncVisible.mutate(
                { items: syncable, onProgress: setSyncProgress },
                {
                  onSuccess: () => {
                    toast.success(`Synced ${syncable.length} task${syncable.length !== 1 ? "s" : ""}`);
                    setSyncProgress(null);
                  },
                  onError: () => {
                    toast.error("Sync failed");
                    setSyncProgress(null);
                  },
                }
              );
            }}
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
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead className="w-[100px]">Parent</TableHead>
                  <TableHead className="w-[100px]">Key</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[120px]">Repo</TableHead>
                  <TableHead className="w-[150px]">Branch</TableHead>
                  <TableHead className="w-[60px]">PR</TableHead>
                  <TableHead className="w-[50px]">Checks</TableHead>
                  <TableHead className="w-[60px]">Reviews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((task) => (
                  <CompletedTaskRow key={task.id} task={task} jiraHost={jiraHost} />
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>

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

interface CompletedTaskRowProps {
  task: TaskWithRepository;
  jiraHost: string | null;
}

function CompletedTaskRow({ task, jiraHost }: CompletedTaskRowProps) {
  const repo = task.repository;
  const syncTask = useSyncTask();

  const prUrl = getPrUrl(repo, task.prNumber);

  // Only show sync if task has Jira or PR
  const canSync = task.jiraKey || task.prNumber;

  const handleSync = (e: React.MouseEvent) => {
    e.stopPropagation();
    syncTask.mutate({ task, repo: repo ?? undefined });
  };

  return (
    <TableRow>
      {/* Sync */}
      <TableCell>
        {canSync && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleSync}
            disabled={syncTask.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${syncTask.isPending ? "animate-spin" : ""}`} />
          </Button>
        )}
      </TableCell>

      {/* Type */}
      <TableCell>
        {task.type ? (
          <Badge variant="outline" className="text-xs">
            {task.type}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Parent */}
      <TableCell>
        <ParentCell task={task} jiraHost={jiraHost} />
      </TableCell>

      {/* Jira Key */}
      <TableCell>
        {task.jiraKey ? (() => {
          const jiraUrl = getJiraUrl(task.jiraKey, jiraHost);
          return jiraUrl ? (
            <a
              href={jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-mono text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {task.jiraKey}
            </a>
          ) : (
            <span className="font-mono text-xs">{task.jiraKey}</span>
          );
        })() : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Status */}
      <TableCell>
        <InteractiveStatusBadge
          taskId={task.id}
          status={task.status}
          jiraKey={task.jiraKey}
        />
      </TableCell>

      {/* Title */}
      <TableCell className="max-w-[300px]">
        <Link
          to={`/tasks/${task.id}`}
          className="hover:underline truncate block"
          title={task.title}
        >
          {task.title}
        </Link>
      </TableCell>

      {/* Repository */}
      <TableCell>
        {repo ? (
          <RepoBadge repo={repo} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Branch */}
      <TableCell className="font-mono text-xs max-w-[150px] truncate" title={task.headBranch || undefined}>
        {task.headBranch ? (
          <button
            type="button"
            className="hover:text-blue-600 cursor-pointer text-left"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(task.headBranch!);
              toast.success("Branch copied to clipboard");
            }}
          >
            {task.headBranch}
          </button>
        ) : (
          "—"
        )}
      </TableCell>

      {/* PR Number */}
      <TableCell>
        {task.prNumber ? (
          prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
              <span>#{task.prNumber}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              <PrStatusIcon prState={task.prState} isDraft={task.isDraft} />
              <span>#{task.prNumber}</span>
            </span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Checks */}
      <TableCell>
        <ChecksStatusCell
          checksStatus={task.checksStatus}
          checksDetails={task.checksDetails}
        />
      </TableCell>

      {/* Review */}
      <TableCell>
        <ReviewStatusIcon
          approvedCount={task.approvedReviewCount}
          requiredReviews={repo?.requiredReviews ?? 2}
        />
      </TableCell>
    </TableRow>
  );
}
