import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useChoreDefinitionsQuery, type ChoreDefinition } from "@/client/lib/queries";
import { useBootDevStack, useDevStackOverviewQuery } from "@/client/lib/queries/dev-stack";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { X, Sparkles, ChevronDown, CirclePlay } from "lucide-react";
import { toast } from "sonner";

interface BulkActionsBarProps {
  selectedIds: number[];
  /** Whether every selected task shares the same repository. Irrelevant when only one task is selected. */
  sameRepo: boolean;
  /** The selection's shared repository, or null when tasks span several (or none). */
  repositoryId: number | null;
  onClearSelection: () => void;
  onRunChore: (chore: ChoreDefinition) => void;
}

export function BulkActionsBar({
  selectedIds,
  sameRepo,
  repositoryId,
  onClearSelection,
  onRunChore,
}: BulkActionsBarProps) {
  const { data } = useChoreDefinitionsQuery();
  const isMulti = selectedIds.length > 1;
  const availableChores = (data?.items ?? []).filter(
    (c) => (!isMulti || c.supportsBulk) && (!c.requiresSameRepo || sameRepo),
  );

  return (
    <div className="h-9 flex items-center gap-4">
      <span className="font-medium">{selectedIds.length} selected</span>
      <Button variant="ghost" size="sm" onClick={onClearSelection}>
        <X className="h-4 w-4 mr-1" />
        Clear
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={availableChores.length === 0}>
            <Sparkles className="h-4 w-4 mr-2" />
            Run chore
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {availableChores.map((chore) => (
            <DropdownMenuItem
              key={chore.key}
              onClick={() => onRunChore(chore)}
              className="flex items-center gap-2"
            >
              <span className="text-xs font-semibold text-muted-foreground tabular-nums w-6">
                #{chore.number}
              </span>
              <span>{chore.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {isMulti && sameRepo && repositoryId !== null && (
        <StartMergedStackButton selectedIds={selectedIds} repositoryId={repositoryId} />
      )}
    </div>
  );
}

/**
 * Boots the repository's dev stack on the first selected task's branch with the
 * other selected tasks' branches merged on top. Hidden for repositories without
 * dev stack support; disabled while a stack is already up for the repository
 * (stop it from any of its tasks' rows).
 */
function StartMergedStackButton({ selectedIds, repositoryId }: { selectedIds: number[]; repositoryId: number }) {
  const { data } = useDevStackOverviewQuery();
  const boot = useBootDevStack();
  if (!data?.supportedRepositoryIds.includes(repositoryId)) return null;

  const stack = data.stacks.find((s) => s.repositoryId === repositoryId);
  const [taskId, ...withTaskIds] = selectedIds;
  const onClick = () =>
    boot.mutate(
      { taskId, withTaskIds },
      {
        onSuccess: () => toast.success(`Booting the dev stack with ${selectedIds.length} tasks merged`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Dev stack request failed"),
      },
    );

  const button = (
    <Button variant="outline" onClick={onClick} disabled={!!stack || boot.isPending}>
      <CirclePlay className="h-4 w-4 mr-2" />
      Start stack
    </Button>
  );
  if (!stack) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>Dev stack is already up for {stack.branch}</TooltipContent>
    </Tooltip>
  );
}
