import { useState } from "react";
import { useTasksQuery } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Search } from "lucide-react";

interface TaskLinkerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTaskIds: number[];
  onSave: (taskIds: number[]) => void;
  isSaving?: boolean;
}

export function TaskLinker({
  open,
  onOpenChange,
  linkedTaskIds,
  onSave,
  isSaving,
}: TaskLinkerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(linkedTaskIds)
  );
  const [search, setSearch] = useState("");

  // Fetch all tasks (not just non-completed)
  const { data: tasksData, isLoading } = useTasksQuery({ excludeCompleted: false });

  // Reset selection when opening
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setSelectedIds(new Set(linkedTaskIds));
      setSearch("");
    }
    onOpenChange(newOpen);
  };

  const filteredTasks = (tasksData?.items ?? []).filter((task) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      task.title.toLowerCase().includes(searchLower) ||
      (task.jiraKey && task.jiraKey.toLowerCase().includes(searchLower))
    );
  });

  const toggleTask = (taskId: number) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(taskId)) {
      newSelection.delete(taskId);
    } else {
      newSelection.add(taskId);
    }
    setSelectedIds(newSelection);
  };

  const handleSave = () => {
    onSave(Array.from(selectedIds));
  };

  const footer = (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(false)}>
        Cancel
      </Button>
      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? "Saving..." : `Save (${selectedIds.size} linked)`}
      </Button>
    </>
  );

  return (
    <ModalDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Link Tasks"
      size="md"
      footer={footer}
    >
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-1 max-h-96">
        {isLoading && (
          <p className="text-muted-foreground text-center py-4">Loading...</p>
        )}
        {!isLoading && filteredTasks.length === 0 && (
          <p className="text-muted-foreground text-center py-4">No tasks found</p>
        )}
        {filteredTasks.map((task) => (
          <label
            key={task.id}
            className="flex items-center gap-3 px-2 py-2 hover:bg-muted rounded cursor-pointer"
          >
            <Checkbox
              checked={selectedIds.has(task.id)}
              onCheckedChange={() => toggleTask(task.id)}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {task.jiraKey && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {task.jiraKey}
                  </span>
                )}
                <span className="truncate text-sm">{task.title}</span>
              </div>
            </div>
          </label>
        ))}
      </div>
    </ModalDialog>
  );
}
