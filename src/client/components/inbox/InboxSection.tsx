import type { ReactNode } from "react";
import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { CopyChip } from "@/client/components/ui/copy-chip";
import { formatRelativeTime } from "@/client/lib/time";
import type { InboxSession, InboxTask } from "@/shared/inbox";

/** One Inbox section: a heading with a count over a card list. Renders nothing when empty. */
export function InboxSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="font-normal">({count})</span>
      </h2>
      <div className="divide-y divide-border rounded-lg border border-border bg-card">{children}</div>
    </section>
  );
}

/** `at` is when the item entered the inbox (a session blocked, a hold was recorded, a build went red). */
export function InboxRow({ children, actions, at }: { children: ReactNode; actions?: ReactNode; at?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3">
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {at && (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="text-xs text-muted-foreground">
            {formatRelativeTime(at)}
          </time>
        )}
        {actions && <div className="flex flex-wrap items-center justify-end gap-3 text-xs">{actions}</div>}
      </div>
    </div>
  );
}

export function TaskLabel({ task }: { task: InboxTask }) {
  return (
    <Link to={`/tasks/${task.id}`} className="block truncate font-medium hover:underline">
      {task.jiraKey && <span className="mr-2 text-muted-foreground">{task.jiraKey}</span>}
      {task.title}
    </Link>
  );
}

export function ExternalA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      {children}
    </a>
  );
}

/** The claude.ai link and the `claude attach` chip, as in the sessions table. */
export function SessionLinks({ session }: { session: InboxSession }) {
  return (
    <>
      {session.link && <ExternalA href={session.link}>Open on claude.ai</ExternalA>}
      {session.shortId && <CopyChip value={`claude attach ${session.shortId}`}>attach {session.shortId}</CopyChip>}
    </>
  );
}
