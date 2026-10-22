import { Link } from "react-router";
import { Flame } from "lucide-react";
import type { ReviewScope } from "@/client/lib/queries/reviews";
import type { ClaudeSession, Repository, ReviewRequest } from "@/shared/types";
import { categorizePrSize } from "@/shared/pr-size";
import { memberTag, prKey, requestTag, type MemberTag } from "@/client/lib/review-ownership";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { RepoBadge } from "@/client/components/tasks/RepoBadge";
import { DevStackToggle } from "@/client/components/tasks/DevStackToggle";
import { ChangesSummary } from "@/client/components/tasks/ChangesSummary";
import { ReviewStatusIcon, PrStatusIcon } from "@/client/components/tasks/StatusIcons";
import { FlameToggle, JiraLink } from "@/client/components/tasks/columns/cells";
import { ReviewCell } from "./ReviewCell";
import { SizeBadge } from "./SizeBadge";

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSeconds = Math.round((then - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return rtf.format(diffSeconds, "second");
}

const HIGHLIGHT_ACCENT =
  "[&>td:first-child]:relative [&>td:first-child]:before:content-[''] [&>td:first-child]:before:absolute [&>td:first-child]:before:inset-y-0 [&>td:first-child]:before:left-0 [&>td:first-child]:before:w-1";

const VIP_ROW = `bg-rose-50/60 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 ${HIGHLIGHT_ACCENT} [&>td:first-child]:before:bg-rose-400 dark:[&>td:first-child]:before:bg-rose-500`;

const TEAM_ROW = `bg-amber-50/60 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 ${HIGHLIGHT_ACCENT} [&>td:first-child]:before:bg-amber-400 dark:[&>td:first-child]:before:bg-amber-500`;

interface ReviewTableProps {
  items: ReviewRequest[];
  repoBySlug: Map<string, Repository>;
  sessionFor: (request: ReviewRequest) => ClaudeSession | undefined;
  showSize: boolean;
  scope: ReviewScope;
  jiraHost?: string | null;
  teamMembers: Set<string>;
  vips: Set<string>;
  highPriorityPrs: Set<string>;
  onToggleHighPriority: (key: string) => void;
}

export function ReviewTable({ items, repoBySlug, sessionFor, showSize, scope, jiraHost, teamMembers, vips, highPriorityPrs, onToggleHighPriority }: ReviewTableProps) {
  const isMine = scope === "mine";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {!isMine && (
            <TableHead className="w-[40px]">
              <Flame className="h-4 w-4" />
            </TableHead>
          )}
          {isMine && <TableHead className="w-[80px]">Task</TableHead>}
          {isMine && <TableHead className="w-[110px]">Jira</TableHead>}
          <TableHead className="w-[80px]">PR</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-[110px]">Review</TableHead>
          <TableHead className="w-[150px]">Repo</TableHead>
          <TableHead className="w-[120px]">Author</TableHead>
          <TableHead className="w-[120px]">Assignee</TableHead>
          <TableHead className="w-[120px]">Created</TableHead>
          {showSize && <TableHead className="w-[110px]">Size</TableHead>}
          <TableHead className="w-[100px]">Changes</TableHead>
          <TableHead>Reviews</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((request) => (
          <ReviewRequestRow
            key={prKey(request)}
            request={request}
            repo={repoBySlug.get(`${request.repo.owner}/${request.repo.repo}`)}
            session={sessionFor(request)}
            showSize={showSize}
            isMine={isMine}
            jiraHost={jiraHost}
            teamMembers={teamMembers}
            vips={vips}
            isHighPriority={highPriorityPrs.has(prKey(request))}
            onToggleHighPriority={() => onToggleHighPriority(prKey(request))}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function MemberName({ login, tag }: { login: string; tag: MemberTag | null }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex w-10 shrink-0">
        {tag === "vip" ? (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-rose-400 bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100 dark:border-rose-500"
          >
            VIP
          </Badge>
        ) : tag === "team" ? (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-500"
          >
            Team
          </Badge>
        ) : null}
      </span>
      <span>{login}</span>
    </div>
  );
}

/** The repo badge, with the dev stack toggle for the PR when the repo is configured. */
function RequestRepo({ request, repo }: { request: ReviewRequest; repo?: Repository }) {
  if (!repo) {
    return (
      <Badge variant="outline" className="text-xs">
        {request.repo.repo}
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <RepoBadge repo={repo} />
      <DevStackToggle owner={{ prUrl: request.url }} repositoryId={repo.id} label={`${request.repo.repo}#${request.prNumber}`} />
    </span>
  );
}

interface ReviewRequestRowProps {
  request: ReviewRequest;
  repo?: Repository;
  session?: ClaudeSession;
  showSize: boolean;
  isMine: boolean;
  jiraHost?: string | null;
  teamMembers: Set<string>;
  vips: Set<string>;
  isHighPriority: boolean;
  onToggleHighPriority: () => void;
}

function ReviewRequestRow({ request, repo, session, showSize, isMine, jiraHost, teamMembers, vips, isHighPriority, onToggleHighPriority }: ReviewRequestRowProps) {
  const tag = requestTag(request, teamMembers, vips);
  const member = (login: string) => <MemberName key={login} login={login} tag={memberTag(login, teamMembers, vips)} />;
  const dash = <span className="text-muted-foreground">—</span>;
  return (
    <TableRow className={tag === "vip" ? VIP_ROW : tag === "team" ? TEAM_ROW : undefined}>
      {isMine ? (
        <>
          <TableCell>
            {request.taskId != null ? (
              <Link to={`/tasks/${request.taskId}`} className="font-mono text-xs text-blue-600 hover:underline">
                #{request.taskId}
              </Link>
            ) : dash}
          </TableCell>
          <TableCell>{request.taskJiraKey ? <JiraLink jiraKey={request.taskJiraKey} jiraHost={jiraHost} /> : dash}</TableCell>
        </>
      ) : (
        <TableCell>
          <FlameToggle active={isHighPriority} onToggle={onToggleHighPriority} />
        </TableCell>
      )}
      <TableCell>
        <a href={request.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline">
          <PrStatusIcon prState={request.state} isDraft={request.isDraft ? 1 : 0} />
          <span>#{request.prNumber}</span>
        </a>
      </TableCell>
      <TableCell className="max-w-[400px]">
        <a href={request.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate block" title={request.title}>
          {request.title}
        </a>
      </TableCell>
      <TableCell>
        <ReviewCell
          session={session}
          start={isMine ? (request.taskId != null ? { taskId: request.taskId } : null) : { prUrl: request.url }}
          disabledReason={isMine && request.taskId == null ? "No task for this PR" : undefined}
          hasDraft={!isMine && request.hasPendingReview}
          prUrl={request.url}
        />
      </TableCell>
      <TableCell>
        <RequestRepo request={request} repo={repo} />
      </TableCell>
      <TableCell className="text-sm">{member(request.author)}</TableCell>
      <TableCell className="text-sm">
        {request.assignees.length ? <div className="flex flex-col gap-0.5">{request.assignees.map(member)}</div> : dash}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground" title={new Date(request.createdAt).toLocaleString()}>
        {formatRelativeTime(request.createdAt)}
      </TableCell>
      {showSize && (
        <TableCell>
          <SizeBadge size={categorizePrSize(request.additions, request.deletions)} />
        </TableCell>
      )}
      <TableCell>
        <ChangesSummary changedFiles={request.changedFiles} additions={request.additions} deletions={request.deletions} changesByCategory={request.changesByCategory} />
      </TableCell>
      <TableCell>
        <ReviewStatusIcon status={request.reviewStatus} prUrl={request.url} highlight={isMine ? undefined : request.myMissingCodeOwners} />
      </TableCell>
    </TableRow>
  );
}
