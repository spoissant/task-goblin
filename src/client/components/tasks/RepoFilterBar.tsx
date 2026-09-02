import { useMemo } from "react";
import { useTasksQuery, useRepositoriesQuery } from "@/client/lib/queries";
import { Badge } from "@/client/components/ui/badge";
import { RepoBadge } from "./RepoBadge";
import { cn } from "@/client/lib/utils";
import type { Repository } from "@/client/lib/types";

interface RepoFilterBarProps {
  titleFilter?: string;
  selectedRepoId: number | null;
  onSelectedRepoIdChange: (repoId: number | null) => void;
}

export function RepoFilterBar({ titleFilter, selectedRepoId, onSelectedRepoIdChange }: RepoFilterBarProps) {
  const { data } = useTasksQuery({ title: titleFilter });
  const { data: reposData } = useRepositoriesQuery();

  const repos = useMemo(() => {
    const repoMap = new Map<number, Repository>();
    for (const repo of reposData?.items ?? []) repoMap.set(repo.id, repo);

    const present = new Map<number, Repository>();
    for (const task of data?.items ?? []) {
      const repo = task.repositoryId ? repoMap.get(task.repositoryId) : undefined;
      if (repo && !present.has(repo.id)) present.set(repo.id, repo);
    }

    return Array.from(present.values()).sort((a, b) => (a.alias || a.repo).localeCompare(b.alias || b.repo));
  }, [data?.items, reposData?.items]);

  if (repos.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      <button type="button" onClick={() => onSelectedRepoIdChange(null)} className="cursor-pointer">
        <Badge variant={selectedRepoId === null ? "default" : "outline"} className="text-xs">
          All
        </Badge>
      </button>
      {repos.map((repo) => (
        <button key={repo.id} type="button" onClick={() => onSelectedRepoIdChange(repo.id)} className="cursor-pointer">
          <RepoBadge repo={repo} className={cn(selectedRepoId === repo.id && "ring-2 ring-offset-1 ring-primary")} />
        </button>
      ))}
    </div>
  );
}
