import { useState } from "react";
import { useDeleteBlocker, useCreateBlocker, useTasksQuery } from "@/client/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Label } from "@/client/components/ui/label";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { BlockedBy } from "@/client/lib/types";

interface BlockedByListProps {
  blockedBy: BlockedBy[];
  taskId: number;
}

export function BlockedByList({ blockedBy, taskId }: BlockedByListProps) {
  const [isAddingBlocker, setIsAddingBlocker] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");

  const deleteBlocker = useDeleteBlocker();
  const createBlocker = useCreateBlocker();
  const { data: tasks } = useTasksQuery();

  const availableTasks = tasks?.items.filter((t) => t.id !== taskId) || [];

  const handleDelete = (id: number) => {
    deleteBlocker.mutate(id, {
      onSuccess: () => toast.success("Blocker removed"),
      onError: () => toast.error("Failed to remove blocker"),
    });
  };

  const handleAddBlocker = () => {
    if (!selectedTaskId) return;

    createBlocker.mutate(
      {
        blockedTaskId: taskId,
        blockerTaskId: parseInt(selectedTaskId, 10),
      },
      {
        onSuccess: () => {
          toast.success("Blocker added");
          setSelectedTaskId("");
          setIsAddingBlocker(false);
        },
        onError: () => {
          toast.error("Failed to add blocker");
        },
      }
    );
  };

  const getBlockerLabel = (blocker: BlockedBy) => {
    if (blocker.blockerTaskId) {
      const task = tasks?.items.find((t) => t.id === blocker.blockerTaskId);
      return task ? `Task: ${task.title}` : `Task #${blocker.blockerTaskId}`;
    }
    if (blocker.blockerTodoId) {
      return `Todo #${blocker.blockerTodoId}`;
    }
    if (blocker.blockerPullRequestId) {
      return `PR #${blocker.blockerPullRequestId}`;
    }
    return "Unknown";
  };

  const getBlockerType = (blocker: BlockedBy) => {
    if (blocker.blockerTaskId) return "Task";
    if (blocker.blockerTodoId) return "Todo";
    if (blocker.blockerPullRequestId) return "PR";
    return "Unknown";
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Blocked By</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setIsAddingBlocker(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          {blockedBy.length === 0 ? (
            <p className="text-muted-foreground text-sm">Not blocked by anything</p>
          ) : (
            <ul className="space-y-2">
              {blockedBy.map((blocker) => (
                <li
                  key={blocker.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{getBlockerType(blocker)}</Badge>
                    <span className="text-sm truncate">{getBlockerLabel(blocker)}</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleDelete(blocker.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddingBlocker} onOpenChange={setIsAddingBlocker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Blocker</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label>Select a blocking task</Label>
            <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select a task..." />
              </SelectTrigger>
              <SelectContent>
                {availableTasks.map((task) => (
                  <SelectItem key={task.id} value={String(task.id)}>
                    {task.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingBlocker(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddBlocker} disabled={!selectedTaskId || createBlocker.isPending}>
              Add Blocker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
