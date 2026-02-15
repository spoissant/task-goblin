import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { RepositoryColumn } from "@/client/components/prompts/RepositoryColumn";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";

export function PromptsPage() {
  const { data, isLoading } = useRepositoriesQuery();

  if (isLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Prompts</h1>
        <div className="flex gap-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-96 flex-1" />
          ))}
        </div>
      </div>
    );
  }

  const repos = (data?.items ?? []).filter((r) => r.enabled === 1);

  return (
    <div className="h-full flex flex-col">
      <h1 className="text-2xl font-bold mb-4">Prompts</h1>

      {repos.length === 0 ? (
        <EmptyState message="No enabled repositories. Enable a repository in Settings first." />
      ) : (
        <div className="flex-1 flex gap-4 min-h-0" style={{ height: "calc(100vh - 10rem)" }}>
          {repos.map((repo) => (
            <div key={repo.id} className="flex-1 min-w-0">
              <RepositoryColumn repository={repo} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
