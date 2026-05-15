import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReviewRequestsQuery, reviewKeys } from "@/client/lib/queries";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { RepoBadge } from "@/client/components/tasks/RepoBadge";
import { Button } from "@/client/components/ui/button";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { ReviewStatusIcon, PrStatusIcon } from "@/client/components/tasks/StatusIcons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { EmptyState } from "@/client/components/ui/empty-state";
import {
  RefreshCw,
  GitPullRequestArrow,
  SignalLow,
  SignalMedium,
  SignalHigh,
} from "lucide-react";
import type { ReviewRequest, Repository } from "@/client/lib/types";

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

type SizeCategory = "small" | "medium" | "large";

function categorizePR(pr: ReviewRequest): SizeCategory {
  const files = pr.changedFiles ?? Infinity;
  const lines = (pr.additions ?? 0) + (pr.deletions ?? 0);
  if (files <= 5 && lines <= 200) return "small";
  if (files <= 15 && lines <= 800) return "medium";
  return "large";
}

const SIZE_LABELS: Record<SizeCategory, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

const SIZE_DESCRIPTIONS: Record<SizeCategory, string> = {
  small: "< 10 min",
  medium: "< 30 min",
  large: "30+ min",
};

const SIZE_ICONS: Record<SizeCategory, typeof SignalLow> = {
  small: SignalLow,
  medium: SignalMedium,
  large: SignalHigh,
};

const SIZE_ICON_COLORS: Record<SizeCategory, string> = {
  small: "text-emerald-600",
  medium: "text-amber-600",
  large: "text-red-600",
};

type ViewMode = "grouped" | "flat";
const VIEW_STORAGE_KEY = "reviewsPage.view";

function SizeBadge({ size }: { size: SizeCategory }) {
  const Icon = SIZE_ICONS[size];
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Icon className={`h-4 w-4 ${SIZE_ICON_COLORS[size]}`} />
      <span>{SIZE_LABELS[size]}</span>
    </span>
  );
}

function parseTeamMembers(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, isFetching } = useReviewRequestsQuery();
  const { data: reposData } = useRepositoriesQuery();
  const { data: settings } = useSettingsQuery();
  const teamMembers = useMemo(() => parseTeamMembers(settings?.team_members), [settings?.team_members]);

  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grouped";
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "flat" ? "flat" : "grouped";
  });

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  const repoBySlug = useMemo(() => {
    const map = new Map<string, Repository>();
    if (reposData?.items) {
      for (const repo of reposData.items) {
        map.set(`${repo.owner}/${repo.repo}`, repo);
      }
    }
    return map;
  }, [reposData]);

  const visibleItems = useMemo(() => {
    if (!data?.items) return null;
    return data.items.filter((item) => !item.isDraft);
  }, [data]);

  const groups = useMemo(() => {
    if (!visibleItems) return null;
    const grouped: Record<SizeCategory, ReviewRequest[]> = { small: [], medium: [], large: [] };
    for (const item of visibleItems) {
      grouped[categorizePR(item)].push(item);
    }
    for (const size of Object.keys(grouped) as SizeCategory[]) {
      grouped[size].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    return grouped;
  }, [visibleItems]);

  const flatItems = useMemo(() => {
    if (!visibleItems) return null;
    return [...visibleItems].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [visibleItems]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: reviewKeys.all });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Review Requests</h1>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.total} PR{data.total !== 1 ? "s" : ""} awaiting review
            </span>
          )}
          <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {error && (
        <EmptyState message="Failed to load review requests" />
      )}

      {data && !data.items.length && (
        <EmptyState icon={GitPullRequestArrow} message="No PRs awaiting your review" />
      )}

      {data && data.items.length > 0 && (
        <TooltipProvider>
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)} className="mb-4">
            <TabsList>
              <TabsTrigger value="grouped">Grouped by Size</TabsTrigger>
              <TabsTrigger value="flat">Oldest First</TabsTrigger>
            </TabsList>
          </Tabs>

          {view === "grouped" && groups && (
            <div className="space-y-8">
              {(["small", "medium", "large"] as SizeCategory[]).map((size) => {
                const prs = groups[size];
                if (!prs.length) return null;
                const Icon = SIZE_ICONS[size];
                return (
                  <div key={size}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`h-4 w-4 ${SIZE_ICON_COLORS[size]}`} />
                      <h2 className="text-base font-semibold">{SIZE_LABELS[size]}</h2>
                      <span className="text-xs text-muted-foreground">{SIZE_DESCRIPTIONS[size]}</span>
                      <Badge variant="secondary" className="text-xs">{prs.length}</Badge>
                    </div>
                    <ReviewTable items={prs} repoBySlug={repoBySlug} showSize={false} teamMembers={teamMembers} />
                  </div>
                );
              })}
            </div>
          )}

          {view === "flat" && flatItems && (
            <ReviewTable items={flatItems} repoBySlug={repoBySlug} showSize={true} teamMembers={teamMembers} />
          )}
        </TooltipProvider>
      )}
    </div>
  );
}

interface ReviewTableProps {
  items: ReviewRequest[];
  repoBySlug: Map<string, Repository>;
  showSize: boolean;
  teamMembers: Set<string>;
}

function ReviewTable({ items, repoBySlug, showSize, teamMembers }: ReviewTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px]">PR</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-[150px]">Repo</TableHead>
          <TableHead className="w-[120px]">Author</TableHead>
          <TableHead className="w-[120px]">Created</TableHead>
          {showSize && <TableHead className="w-[110px]">Size</TableHead>}
          <TableHead className="w-[100px]">Changes</TableHead>
          <TableHead className="w-[80px]">Reviews</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((request) => (
          <ReviewRequestRow
            key={`${request.repo.owner}/${request.repo.repo}#${request.prNumber}`}
            request={request}
            repoBySlug={repoBySlug}
            showSize={showSize}
            isTeammate={teamMembers.has(request.author.toLowerCase())}
          />
        ))}
      </TableBody>
    </Table>
  );
}

interface ReviewRequestRowProps {
  request: ReviewRequest;
  repoBySlug: Map<string, Repository>;
  showSize: boolean;
  isTeammate: boolean;
}

function ReviewRequestRow({ request, repoBySlug, showSize, isTeammate }: ReviewRequestRowProps) {
  const repo = repoBySlug.get(`${request.repo.owner}/${request.repo.repo}`);
  return (
    <TableRow
      className={
        isTeammate
          ? "bg-amber-50/60 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 [&>td:first-child]:relative [&>td:first-child]:before:content-[''] [&>td:first-child]:before:absolute [&>td:first-child]:before:inset-y-0 [&>td:first-child]:before:left-0 [&>td:first-child]:before:w-1 [&>td:first-child]:before:bg-amber-400 dark:[&>td:first-child]:before:bg-amber-500"
          : undefined
      }
    >
      {/* PR Number */}
      <TableCell>
        <a
          href={request.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
        >
          <PrStatusIcon prState={request.state} isDraft={request.isDraft ? 1 : 0} />
          <span>#{request.prNumber}</span>
        </a>
      </TableCell>

      {/* Title */}
      <TableCell className="max-w-[400px]">
        <a
          href={request.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline truncate block"
          title={request.title}
        >
          {request.title}
        </a>
      </TableCell>

      {/* Repository */}
      <TableCell>
        {repo ? (
          <RepoBadge repo={repo} />
        ) : (
          <Badge variant="outline" className="text-xs">
            {request.repo.repo}
          </Badge>
        )}
      </TableCell>

      {/* Author */}
      <TableCell className="text-sm">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex w-10 shrink-0">
            {isTeammate && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-500"
              >
                Team
              </Badge>
            )}
          </span>
          <span>{request.author}</span>
        </div>
      </TableCell>

      {/* Created */}
      <TableCell className="text-sm text-muted-foreground" title={new Date(request.createdAt).toLocaleString()}>
        {formatRelativeTime(request.createdAt)}
      </TableCell>

      {/* Size */}
      {showSize && (
        <TableCell>
          <SizeBadge size={categorizePR(request)} />
        </TableCell>
      )}

      {/* Changes */}
      <TableCell>
        {request.changesByCategory == null ? (
          request.changedFiles == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <Badge variant="outline" className="text-xs px-1.5">{request.changedFiles}</Badge>
              <div className="flex flex-col leading-tight text-right">
                <span className="text-green-600">+{request.additions ?? 0}</span>
                <span className="text-red-600">-{request.deletions ?? 0}</span>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-0.5 text-xs font-mono">
            {(["frontend", "backend", "other"] as const).map((cat) => {
              const c = request.changesByCategory![cat];
              if (c.files === 0) return null;
              const label = cat === "frontend" ? "FE" : cat === "backend" ? "BE" : "OT";
              return (
                <div key={cat} className="flex items-center gap-1">
                  <span className="text-muted-foreground w-5">{label}</span>
                  <Badge variant="outline" className="text-xs px-1 py-0">{c.files}</Badge>
                  <span className="text-green-600">+{c.additions}</span>
                  <span className="text-red-600">-{c.deletions}</span>
                </div>
              );
            })}
          </div>
        )}
      </TableCell>

      {/* Reviews */}
      <TableCell>
        <ReviewStatusIcon approvedCount={request.approvedCount} prUrl={request.url} />
      </TableCell>
    </TableRow>
  );
}
