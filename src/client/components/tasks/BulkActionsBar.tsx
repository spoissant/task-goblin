import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useChoreDefinitionsQuery, type ChoreDefinition } from "@/client/lib/queries";
import { X, Clipboard, ChevronDown } from "lucide-react";

interface BulkActionsBarProps {
  selectedIds: number[];
  onClearSelection: () => void;
  onCopyChorePrompt: (chore: ChoreDefinition) => void;
}

export function BulkActionsBar({
  selectedIds,
  onClearSelection,
  onCopyChorePrompt,
}: BulkActionsBarProps) {
  const { data } = useChoreDefinitionsQuery();
  const isMulti = selectedIds.length > 1;
  const availableChores = (data?.items ?? []).filter((c) => !isMulti || c.supportsBulk);

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
            <Clipboard className="h-4 w-4 mr-2" />
            Copy chore prompt
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {availableChores.map((chore) => (
            <DropdownMenuItem
              key={chore.key}
              onClick={() => onCopyChorePrompt(chore)}
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
