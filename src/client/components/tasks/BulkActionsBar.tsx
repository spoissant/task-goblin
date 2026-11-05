import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import type { ChoreDefinition } from "@/shared/chores";
import { orderForRepoPair } from "@/shared/chore-pairs";
import { useBootDevStack, useDevStackOverviewQuery } from "@/client/lib/queries/dev-stack";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { useAssignTasksToGoal, useGoalsQuery } from "@/client/lib/queries/goals";
import { X, Sparkles, ChevronDown, CirclePlay, PenLine, Target, Inbox } from "lucide-react";
import { toast } from "sonner";

interface BulkActionsBarProps {
  selectedIds: number[];
  /** Each selected task's repository name, for two-repo chores. */
  selection: { id: number; repo: string | null }[];
  /** Whether every selected task shares the same repository. Irrelevant when only one task is selected. */
  sameRepo: boolean;
  /** The selection's shared repository, or null when tasks span several (or none). */
  repositoryId: number | null;
  onClearSelection: () => void;
  onRunChore: (chore: ChoreDefinition) => void;
  onCustomPrompt: () => void;
}

export function BulkActionsBar({
  selectedIds,
  selection,
  sameRepo,
  repositoryId,
  onClearSelection,
  onRunChore,
  onCustomPrompt,
}: BulkActionsBarProps) {
  const { data } = useChoreDefinitionsQuery();
  const isMulti = selectedIds.length > 1;
  const availableChores = (data?.items ?? []).filter((c) =>
    c.repoPairs
      ? orderForRepoPair(c.repoPairs, selection) !== null
      : (!isMulti || c.supportsBulk) && (!c.requiresSameRepo || sameRepo),
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
          <Button>
            <Sparkles className="h-4 w-4 mr-2" />
            Run chore
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem onClick={onCustomPrompt} className="flex items-center gap-2">
            <PenLine className="h-3.5 w-6 text-muted-foreground" />
            <span>Custom prompt...</span>
          </DropdownMenuItem>
          {availableChores.length > 0 && <DropdownMenuSeparator />}
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
      <MoveToGoalMenu selectedIds={selectedIds} onDone={onClearSelection} />
      {isMulti && sameRepo && repositoryId !== null && (
        <StartMergedStackButton selectedIds={selectedIds} repositoryId={repositoryId} />
      )}
    </div>
  );
}

/** Puts the selected tasks under a goal, or back in Unassigned. Hidden until a goal exists. */
function MoveToGoalMenu({ selectedIds, onDone }: { selectedIds: number[]; onDone: () => void }) {
  const { data } = useGoalsQuery();
  const assign = useAssignTasksToGoal();
  const goals = data?.items ?? [];
  if (goals.length === 0) return null;

  const move = (goalId: number | null, label: string) =>
    assign.mutate(
      { taskIds: selectedIds, goalId },
      {
        onSuccess: () => {
          toast.success(`Moved ${selectedIds.length} task${selectedIds.length > 1 ? "s" : ""} to ${label}`);
          onDone();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to move tasks"),
      },
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={assign.isPending}>
          <Target className="h-4 w-4 mr-2" />
          Move to goal
          <ChevronDown className="h-4 w-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {goals.map((goal) => (
          <DropdownMenuItem key={goal.id} onClick={() => move(goal.id, goal.name)}>
            {goal.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => move(null, "Unassigned")} className="flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          Unassigned
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
