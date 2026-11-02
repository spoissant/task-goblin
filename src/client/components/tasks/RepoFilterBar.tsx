import { useMemo } from "react";
import { useTasksQuery } from "@/client/lib/queries/tasks";
import { Badge } from "@/client/components/ui/badge";
import { RepoBadge } from "./RepoBadge";
import { cn } from "@/client/lib/utils";
import { cycleRepo, repoState, type TaskFilters } from "@/client/lib/taskFilters";
import type { Repository } from "@/shared/types";

type RepoFilters = Pick<TaskFilters, "repo" | "notRepo">;

interface RepoFilterBarProps {
  titleFilter?: string;
  filters: RepoFilters;
  onChange: (patch: RepoFilters) => void;
}

const STATE_CLASS = {
  off: "",
  include: "ring-2 ring-offset-1 ring-primary",
  exclude: "ring-2 ring-offset-1 ring-destructive line-through opacity-60",
} as const;

const STATE_TITLE = {
  off: "Click to show only this repository",
  include: "Shown only — click to hide this repository",
  exclude: "Hidden — click to clear",
} as const;

export function RepoFilterBar({ titleFilter, filters, onChange }: RepoFilterBarProps) {
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

  const noneActive = filters.repo.length === 0 && filters.notRepo.length === 0;

  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      <button type="button" onClick={() => onChange({ repo: [], notRepo: [] })} className="cursor-pointer">
        <Badge variant={noneActive ? "default" : "outline"} className="text-xs">
          All
        </Badge>
      </button>
      {repos.map((repo) => {
        const state = repoState(filters, repo.id);
        return (
          <button
            key={repo.id}
            type="button"
            title={STATE_TITLE[state]}
            onClick={() => onChange(cycleRepo(filters, repo.id))}
            className="cursor-pointer"
          >
            <RepoBadge repo={repo} className={cn(STATE_CLASS[state])} />
          </button>
        );
      })}
    </div>
  );
}
