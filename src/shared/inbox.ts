// The Inbox: everything that waits on the user, aggregated by GET /api/v1/inbox
// (see src/server/services/inbox.ts) and rendered by the Inbox page.
import type { HoldReason } from "./merge";

export interface InboxSession {
  id: number;
  choreKey: string;
  choreName: string;
  name: string;
  state: string;
  needs: string | null;
  detail: string | null;
  error: string | null;
  link: string | null; // https://claude.ai/code/session_XXX
  shortId: string | null; // for `claude attach <shortId>`
  prUrl: string | null; // task-less PR review sessions
}

export interface InboxTask {
  id: number;
  title: string;
  jiraKey: string | null;
  status: string;
  prNumber: number | null;
  repository: { owner: string; repo: string } | null;
}

export type InboxItem =
  | { kind: "blocked"; at: string; session: InboxSession; task: InboxTask | null }
  | { kind: "failed"; at: string; session: InboxSession; task: InboxTask | null }
  | { kind: "merge-hold"; at: string; task: InboxTask; reasons: HoldReason[]; prUrl: string }
  | { kind: "sprint-red"; at: string; task: InboxTask; buildUrl: string | null; session: InboxSession | null }
  | { kind: "ready-to-start"; at: string; task: InboxTask };

export type InboxKind = InboxItem["kind"];
