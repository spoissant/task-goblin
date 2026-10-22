import { useState } from "react";
import { Check, Copy, Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useGenerateStandup, useJiraConfigQuery, useStandupsQuery } from "@/client/lib/queries";
import { linkJiraKeys } from "@/client/lib/standup";
import { formatCost } from "@/client/lib/sessions";
import { Button } from "@/client/components/ui/button";
import { Markdown } from "@/client/components/ui/markdown";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import type { Standup } from "@/shared/types";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUsage(s: Standup): string {
  const parts = [`Generated ${formatWhen(s.createdAt)}`];
  if (s.durationMs !== null) parts.push(`${Math.round(s.durationMs / 1000)}s`);
  if (s.costUsd !== null) parts.push(formatCost(s.costUsd));
  return parts.join(" · ");
}

export function StandupPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isPending, isError, error } = useStandupsQuery();
  const { data: jiraConfig } = useJiraConfigQuery();
  const generate = useGenerateStandup();

  const items = data?.items ?? [];
  const selected = items.find((s) => s.id === selectedId) ?? items[0] ?? null;
  const running = items.some((s) => s.state === "running");

  const start = async () => {
    try {
      await generate.mutateAsync();
      setSelectedId(null); // follow the new run
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the standup.");
    }
  };

  const copyMarkdown = async () => {
    if (!selected?.markdown) return;
    await navigator.clipboard.writeText(selected.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Standup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What your AI sessions did since the last standup, with where each task stands now.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {items.length > 1 && selected && (
            <Select value={String(selected.id)} onValueChange={(v) => setSelectedId(Number(v))}>
              <SelectTrigger className="w-[190px]">
                <SelectValue>{formatWhen(selected.createdAt)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {formatWhen(s.createdAt)}
                    {s.state !== "done" && ` · ${s.state}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selected?.markdown && (
            <Button variant="outline" size="sm" onClick={copyMarkdown}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          <Button size="sm" onClick={start} disabled={running || generate.isPending}>
            <Sparkles className={running ? "animate-pulse" : undefined} />
            {running ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>

      {isPending && <Skeleton className="h-40 w-full" />}

      {isError && (
        <EmptyState
          icon={Mic}
          message={error instanceof Error ? `Could not load standups: ${error.message}` : "Could not load standups."}
        />
      )}

      {!isPending && !isError && !selected && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Mic className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <p className="font-medium">No standup yet</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Generate one before the meeting. It takes about a minute.
          </p>
        </div>
      )}

      {selected?.state === "running" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reading sessions and syncing the board. This takes about a minute.
          </p>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {selected?.state === "failed" && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Generation failed</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{selected.error}</p>
        </div>
      )}

      {selected?.state === "done" && selected.markdown && (
        <>
          <Markdown className="prose-headings:font-semibold prose-h2:text-xl prose-h2:mt-0 prose-li:my-0.5">
            {linkJiraKeys(selected.markdown, jiraConfig?.jira_host)}
          </Markdown>
          <p className="mt-6 text-xs text-muted-foreground">{formatUsage(selected)}</p>
        </>
      )}
    </div>
  );
}
