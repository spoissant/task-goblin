import { useQueryClient } from "@tanstack/react-query";
import { useReviewRequestsQuery, reviewKeys } from "@/client/lib/queries";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Badge } from "@/client/components/ui/badge";
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
import { RefreshCw, GitPullRequestArrow } from "lucide-react";
import type { ReviewRequest } from "@/client/lib/types";

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, isFetching } = useReviewRequestsQuery();

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
        <div className="text-center py-12 text-muted-foreground">
          Failed to load review requests
        </div>
      )}

      {data && !data.items.length && (
        <div className="text-center py-12">
          <GitPullRequestArrow className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No PRs awaiting your review</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">PR</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-[150px]">Repo</TableHead>
                <TableHead className="w-[120px]">Author</TableHead>
                <TableHead className="w-[80px]">Reviews</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((request) => (
                <ReviewRequestRow key={`${request.repo.owner}/${request.repo.repo}#${request.prNumber}`} request={request} />
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      )}
    </div>
  );
}

interface ReviewRequestRowProps {
  request: ReviewRequest;
}

function ReviewRequestRow({ request }: ReviewRequestRowProps) {
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
        <Badge variant="outline" className="text-xs">
          {request.repo.repo}
        </Badge>
      </TableCell>

      {/* Author */}
      <TableCell className="text-sm">
        {request.author}
      </TableCell>

      {/* Reviews */}
      <TableCell>
        <ReviewStatusIcon approvedCount={request.approvedCount} prUrl={request.url} />
      </TableCell>
    </TableRow>
  );
}
