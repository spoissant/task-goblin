import { useState } from "react";
import { Bot } from "lucide-react";
import { useRecentSessionsQuery } from "@/client/lib/queries/sessions";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Pagination } from "@/client/components/ui/pagination";
import { SessionsTable } from "@/client/components/tasks/SessionsTable";

const PAGE_SIZE = 50;

export function SessionsPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useRecentSessionsQuery({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">AI Sessions</h1>
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p className="text-sm text-red-500">{error instanceof Error ? error.message : "Failed to load sessions"}</p>
      ) : !data?.items.length ? (
        <EmptyState message="No AI sessions yet" icon={Bot} />
      ) : (
        <>
          <SessionsTable sessions={data.items} showTask />
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-6" />
        </>
      )}
    </div>
  );
}
