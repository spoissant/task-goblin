import { useState } from "react";
import { TableCell, TableRow } from "@/client/components/ui/table";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useDeleteGoal, useUpdateGoal } from "@/client/lib/queries/goals";
import { GoalDialog } from "./GoalDialog";
import { Archive, ArrowDown, ArrowUp, Inbox, MoreHorizontal, Pencil, ScrollText, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { GoalListItem } from "@/shared/types";

interface GoalSectionRowProps {
  /** The section's goal; null for the Unassigned section. */
  goal: GoalListItem | null;
  /** IDs of the section's rows after filtering, for the section checkbox. */
  visibleIds: number[];
  selectedIds: Set<number>;
  onSelectSection: (ids: number[], selected: boolean) => void;
  /** Cells the row spans besides the checkbox. */
  colSpan: number;
  /** Reorder handlers; undefined when the goal is already first or last (or for Unassigned). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

/** One section header on the Tasks page: name, progress, and the goal's menu. */
export function GoalSectionRow({ goal, visibleIds, selectedIds, onSelectSection, colSpan, onMoveUp, onMoveDown }: GoalSectionRowProps) {
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell>
        <Checkbox
          checked={allSelected}
          disabled={visibleIds.length === 0}
          onCheckedChange={(checked) => onSelectSection(visibleIds, !!checked)}
        />
      </TableCell>
      <TableCell colSpan={colSpan}>
        <div className="flex items-center gap-3 h-7">
          {goal ? <Target className="h-4 w-4 text-muted-foreground" /> : <Inbox className="h-4 w-4 text-muted-foreground" />}
          <span className="font-semibold">{goal?.name ?? "Unassigned"}</span>
          {goal?.context && <ScrollText className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has shared context" />}
          {goal ? <GoalProgress goal={goal} /> : <span className="text-sm text-muted-foreground tabular-nums">{visibleIds.length}</span>}
          <span className="flex-1" />
          {goal && <GoalMenu goal={goal} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Done over total, with a thin bar. Counts every task of the goal, completed ones included. */
function GoalProgress({ goal }: { goal: GoalListItem }) {
  const percent = goal.taskCount ? Math.round((goal.doneCount / goal.taskCount) * 100) : 0;
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground" title={`${percent}% done`}>
      <span className="tabular-nums">
        {goal.doneCount}/{goal.taskCount}
      </span>
      <span className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
        <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function GoalMenu({ goal, onMoveUp, onMoveDown }: { goal: GoalListItem; onMoveUp?: () => void; onMoveDown?: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const archive = () =>
    updateGoal.mutate(
      { id: goal.id, archived: true },
      { onSuccess: () => toast.success(`Archived ${goal.name}`), onError: () => toast.error("Failed to archive goal") },
    );
  const remove = () => {
    if (!confirm(`Delete goal "${goal.name}"? Its ${goal.taskCount} tasks become unassigned.`)) return;
    deleteGoal.mutate(goal.id, {
      onSuccess: () => toast.success(`Deleted ${goal.name}`),
      onError: () => toast.error("Failed to delete goal"),
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Goal actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMoveUp} disabled={!onMoveUp}>
            <ArrowUp className="h-4 w-4 mr-2" /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMoveDown} disabled={!onMoveDown}>
            <ArrowDown className="h-4 w-4 mr-2" /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={archive}>
            <Archive className="h-4 w-4 mr-2" /> Archive
          </DropdownMenuItem>
          <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <GoalDialog open={editOpen} onOpenChange={setEditOpen} goal={goal} />
    </>
  );
}
