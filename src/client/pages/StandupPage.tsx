import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Camera, RefreshCw, Mic } from "lucide-react";
import { toast } from "sonner";
import {
  standupKeys,
  useStandupQuery,
  useTakeSnapshot,
} from "@/client/lib/queries/standup";
import { useSyncAll } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Selected value shows date + time; the option list stays date-only since
 *  only the two selected snapshots' timestamps are in the report. */
function formatDateTime(date: string, takenAt: string): string {
  const time = new Date(takenAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(date)} · ${time}`;
}

export function StandupPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [copied, setCopied] = useState(false);

  const { data, isPending, isError, error } = useStandupQuery(range);
  const takeSnapshot = useTakeSnapshot();
  const syncAll = useSyncAll();

  const report = data?.report ?? null;
  const available = data?.available ?? [];
  const busy = syncAll.isPending || takeSnapshot.isPending;

  /** Sync first so the snapshot reflects Jira and GitHub as of now, not as of
   *  whenever the last sync happened. */
  const snapshotNow = async () => {
    let synced = true;
    try {
      await syncAll.mutateAsync();
    } catch {
      synced = false;
      toast.warning("Sync failed — snapshotting the board as it stands.");
    }
    try {
      const result = await takeSnapshot.mutateAsync({ synced });
      toast.success(`Snapshot for ${result.date} saved — ${result.taskCount} tasks.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not write the snapshot.");
    }
  };

  const copyMarkdown = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Standup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What changed between two daily snapshots of your board.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={snapshotNow} disabled={busy}>
            <Camera className={busy ? "animate-pulse" : undefined} />
            {syncAll.isPending ? "Syncing…" : takeSnapshot.isPending ? "Saving…" : "Snapshot now"}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Refresh"
            disabled={isPending}
            onClick={() => queryClient.invalidateQueries({ queryKey: standupKeys.all })}
          >
            <RefreshCw className={isPending ? "animate-spin" : undefined} />
          </Button>
          {report && (
            <Button variant="outline" size="sm" onClick={copyMarkdown}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </div>
      </div>

      {available.length >= 2 && report && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Compare</span>
          <Select
            value={report.from}
            onValueChange={(from) => setRange((r) => ({ ...r, from }))}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue>{formatDateTime(report.from, report.fromTakenAt)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {available
                .filter((d) => d < report.to)
                .map((d) => (
                  <SelectItem key={d} value={d}>
                    {formatDate(d)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">to</span>
          <Select
            value={report.to}
            onValueChange={(to) =>
              // Keep `from` earlier than `to`; let the server re-pick otherwise.
              setRange((r) => ({ to, from: r.from && r.from < to ? r.from : undefined }))
            }
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue>{formatDateTime(report.to, report.takenAt)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {available.slice(1).map((d) => (
                <SelectItem key={d} value={d}>
                  {formatDate(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">
            · {report.changedCount} task{report.changedCount === 1 ? "" : "s"} changed
          </span>
        </div>
      )}

      {isPending && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {isError && (
        <EmptyState
          icon={Mic}
          message={
            error instanceof Error
              ? `Could not load the report: ${error.message}`
              : "Could not load the report."
          }
        />
      )}

      {!isPending && !isError && !report && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Mic className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <p className="font-medium">Not enough snapshots yet</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            {available.length === 0
              ? "Task Goblin keeps no history, so summaries come from comparing daily snapshots. Take the first one now — once a second exists, this page shows what moved in between."
              : `Only one snapshot so far (${formatDate(available[0]!)}). Take the next one before your next meeting to see what moved in between.`}
          </p>
          <Button className="mt-5" onClick={snapshotNow} disabled={busy}>
            <Camera />
            {syncAll.isPending ? "Syncing…" : takeSnapshot.isPending ? "Saving…" : "Take a snapshot"}
          </Button>
        </div>
      )}

      {report && (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-xl prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3 prose-li:my-0.5">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {children}
                </a>
              ),
            }}
          >
            {report.markdown}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
