import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReviewRequestsQuery, reviewKeys } from "@/client/lib/queries";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
import { RepoBadge } from "@/client/components/tasks/RepoBadge";
import { Button } from "@/client/components/ui/button";
import { TooltipProvider } from "@/client/components/ui/tooltip";
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
import { RefreshCw, GitPullRequestArrow } from "lucide-react";
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

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, isFetching } = useReviewRequestsQuery();
  const { data: reposData } = useRepositoriesQuery();

  const repoBySlug = useMemo(() => {
    const map = new Map<string, Repository>();
    if (reposData?.items) {
      for (const repo of reposData.items) {
        map.set(`${repo.owner}/${repo.repo}`, repo);
      }
    }
    return map;
  }, [reposData]);

  const groups = useMemo(() => {
    if (!data?.items) return null;
    const grouped: Record<SizeCategory, ReviewRequest[]> = { small: [], medium: [], large: [] };
    for (const item of data.items) {
      grouped[categorizePR(item)].push(item);
    }
    return grouped;
  }, [data]);

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

      {groups && data && data.items.length > 0 && (
        <TooltipProvider>
          <div className="space-y-8">
            {(["small", "medium", "large"] as SizeCategory[]).map((size) => {
              const prs = groups[size];
              if (!prs.length) return null;
              return (
                <div key={size}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-base font-semibold">{SIZE_LABELS[size]}</h2>
                    <span className="text-xs text-muted-foreground">{SIZE_DESCRIPTIONS[size]}</span>
                    <Badge variant="secondary" className="text-xs">{prs.length}</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">PR</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead className="w-[150px]">Repo</TableHead>
                        <TableHead className="w-[120px]">Author</TableHead>
                        <TableHead className="w-[120px]">Created</TableHead>
                        <TableHead className="w-[100px]">Changes</TableHead>
                        <TableHead className="w-[80px]">Reviews</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prs.map((request) => (
                        <ReviewRequestRow
                          key={`${request.repo.owner}/${request.repo.repo}#${request.prNumber}`}
                          request={request}
                          repoBySlug={repoBySlug}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

interface ReviewRequestRowProps {
  request: ReviewRequest;
  repoBySlug: Map<string, Repository>;
}

function ReviewRequestRow({ request, repoBySlug }: ReviewRequestRowProps) {
  const repo = repoBySlug.get(`${request.repo.owner}/${request.repo.repo}`);
  return (
    <TableRow>
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
        {request.author}
      </TableCell>

      {/* Created */}
      <TableCell className="text-sm text-muted-foreground" title={new Date(request.createdAt).toLocaleString()}>
        {formatRelativeTime(request.createdAt)}
      </TableCell>

      {/* Changes */}
      <TableCell>
        {request.changedFiles == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <Badge variant="outline" className="text-xs px-1.5">{request.changedFiles}</Badge>
            <div className="flex flex-col leading-tight text-right">
              <span className="text-green-600">+{request.additions ?? 0}</span>
              <span className="text-red-600">-{request.deletions ?? 0}</span>
            </div>
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
