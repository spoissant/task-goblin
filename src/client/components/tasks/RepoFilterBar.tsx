import { useMemo } from "react";
import { useTasksQuery } from "@/client/lib/queries/tasks";
import { Badge } from "@/client/components/ui/badge";
import { RepoBadge } from "./RepoBadge";
import { cn } from "@/client/lib/utils";
import type { Repository } from "@/shared/types";

interface RepoFilterBarProps {
  titleFilter?: string;
  selectedRepoId: number | null;
  onSelectedRepoIdChange: (repoId: number | null) => void;
}

export function RepoFilterBar({ titleFilter, selectedRepoId, onSelectedRepoIdChange }: RepoFilterBarProps) {
  const { data } = useTasksQuery({ title: titleFilter });

  // The repositories the listed tasks are in
  const repos = useMemo(() => {
    const present = new Map<number, Repository>();
    for (const task of data?.items ?? []) {
      if (task.repository) present.set(task.repository.id, task.repository);
    }
    return Array.from(present.values()).sort((a, b) => (a.alias || a.repo).localeCompare(b.alias || b.repo));
  }, [data?.items]);

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
