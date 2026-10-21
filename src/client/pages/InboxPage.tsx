import { useState } from "react";
import { Inbox } from "lucide-react";
import { useInboxQuery } from "@/client/lib/queries/inbox";
import { useReviewRequestsQuery } from "@/client/lib/queries/reviews";
import { resolveChorePrompt, useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import { CustomPromptDialog, type PromptChore } from "@/client/components/tasks/CustomPromptDialog";
import { ExternalA, InboxRow, InboxSection, SessionLinks, TaskLabel } from "@/client/components/inbox/InboxSection";
import { FailedSessionRow } from "@/client/components/inbox/FailedSessionRow";
import { HOLD_LABELS } from "@/shared/merge";
import type { InboxItem, InboxKind, InboxTask } from "@/shared/inbox";

function ofKind<K extends InboxKind>(items: InboxItem[], kind: K): Extract<InboxItem, { kind: K }>[] {
  return items.filter((i): i is Extract<InboxItem, { kind: K }> => i.kind === kind);
}

const START_TASK_FALLBACK = { number: 1, key: "start-task", name: "Start New Task", prompt: "/chore-start-task {{taskId}}" };

/** What the prompt dialog opens on: a task, pre-filled with a chore or blank. */
type PromptTarget = { taskId: number; chore: PromptChore | null };

/**
 * The home page: every decision waiting on the user, newest first within each
 * section. Blocked sessions are answered on claude.ai or with `claude attach`.
 */
export function InboxPage() {
  const { data, isPending, isError, error } = useInboxQuery();
  const { data: reviews } = useReviewRequestsQuery("others");
  const { data: defs } = useChoreDefinitionsQuery();
  const [prompt, setPrompt] = useState<PromptTarget | null>(null);

  const items = data?.items ?? [];
  const blocked = ofKind(items, "blocked");
  const holds = ofKind(items, "merge-hold");
  const sprintRed = ofKind(items, "sprint-red");
  const failed = ofKind(items, "failed");
  const ready = ofKind(items, "ready-to-start");
  const drafts = (reviews?.items ?? []).filter((r) => r.hasPendingReview);
  const empty = !isPending && !isError && items.length === 0 && drafts.length === 0;

  const startTask = (task: InboxTask) => {
    const def = defs?.items.find((d) => d.key === START_TASK_FALLBACK.key) ?? START_TASK_FALLBACK;
    setPrompt({ taskId: task.id, chore: { ...def, prompt: resolveChorePrompt(def.prompt, task) } });
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What needs you. Everything else moves on its own.
        </p>
      </div>

      {isPending && <Skeleton className="h-40 w-full" />}
      {isError && (
        <EmptyState icon={Inbox} message={error instanceof Error ? `Could not load the inbox: ${error.message}` : "Could not load the inbox."} />
      )}
      {empty && <EmptyState icon={Inbox} message="Nothing needs you right now." />}

      <div className="space-y-8">
        <InboxSection title="Needs your input" count={blocked.length}>
          {blocked.map((item) => (
            <InboxRow key={item.session.id} actions={<SessionLinks session={item.session} />}>
              {item.task ? <TaskLabel task={item.task} /> : <span className="font-medium">{item.session.name}</span>}
              <p className="text-xs text-muted-foreground">{item.session.choreName}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{item.session.needs ?? item.session.detail}</p>
            </InboxRow>
          ))}
        </InboxSection>

        <InboxSection title="Review drafts to submit" count={drafts.length}>
          {drafts.map((r) => (
            <InboxRow key={r.url} actions={<ExternalA href={`${r.url}/files`}>Submit on GitHub</ExternalA>}>
              <a href={`${r.url}/files`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium hover:underline">
                {r.title}
              </a>
              <p className="text-xs text-muted-foreground">
                {r.repo.repo}#{r.prNumber} · {r.author}
              </p>
            </InboxRow>
          ))}
        </InboxSection>

        <InboxSection title="Merge holds" count={holds.length}>
          {holds.map((item) => (
            <InboxRow key={item.task.id} actions={<ExternalA href={item.prUrl}>Open PR</ExternalA>}>
              <TaskLabel task={item.task} />
              <p className="text-sm">{item.reasons.map((r) => HOLD_LABELS[r]).join(", ")}</p>
            </InboxRow>
          ))}
        </InboxSection>

        <InboxSection title="Sprint build red" count={sprintRed.length}>
          {sprintRed.map((item) => (
            <InboxRow
              key={item.task.id}
              actions={
                <>
                  {item.buildUrl && <ExternalA href={item.buildUrl}>Build</ExternalA>}
                  {item.session && <SessionLinks session={item.session} />}
                </>
              }
            >
              <TaskLabel task={item.task} />
              <p className="text-xs text-muted-foreground">
                {item.session ? `Sprint-red session ${item.session.state}` : "No sprint-red session yet"}
              </p>
              {item.session?.detail && <p className="whitespace-pre-wrap break-words text-sm">{item.session.detail}</p>}
            </InboxRow>
          ))}
        </InboxSection>

        <InboxSection title="Failed sessions" count={failed.length}>
          {failed.map((item) => (
            <FailedSessionRow key={item.session.id} item={item} onRetry={(taskId, chore) => setPrompt({ taskId, chore })} />
          ))}
        </InboxSection>

        <InboxSection title="Ready to start" count={ready.length}>
          {ready.map((item) => (
            <InboxRow
              key={item.task.id}
              actions={
                <Button size="sm" onClick={() => startTask(item.task)}>
                  Start
                </Button>
              }
            >
              <TaskLabel task={item.task} />
              <p className="text-xs text-muted-foreground">
                {item.task.status}
                {item.task.repository && ` · ${item.task.repository.repo}`}
              </p>
            </InboxRow>
          ))}
        </InboxSection>
      </div>

      {prompt && (
        <CustomPromptDialog
          open
          onOpenChange={(open) => !open && setPrompt(null)}
          taskId={prompt.taskId}
          chore={prompt.chore}
        />
      )}
    </div>
  );
}
