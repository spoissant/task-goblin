import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useChoreDefinitionsQuery, type ChoreDefinition } from "@/client/lib/queries";
import { X, Sparkles, ChevronDown } from "lucide-react";

interface BulkActionsBarProps {
  selectedIds: number[];
  /** Whether every selected task shares the same repository. Irrelevant when only one task is selected. */
  sameRepo: boolean;
  onClearSelection: () => void;
  onRunChore: (chore: ChoreDefinition) => void;
}

export function BulkActionsBar({
  selectedIds,
  sameRepo,
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
    </div>
  );
}
