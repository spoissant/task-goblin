import { useState, useEffect } from "react";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { BulkActionsBar } from "@/client/components/tasks/BulkActionsBar";
import { useNextChoreQuery, type ChoreDefinition } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

export function TasksPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [hideLowPriority, setHideLowPriority] = useLocalStorage("tasksPage.hideLowPriority", true);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: nextChore } = useNextChoreQuery(hideLowPriority);

  const handleCopyChorePromptForSelection = (chore: ChoreDefinition) => {
    const ids = Array.from(selectedIds).join(" ");
    const prompt = chore.prompt.replace("{{taskId}}", ids).replace("{{jiraKey}}", "");
    navigator.clipboard.writeText(prompt).then(() => {
      toast.success("Copied to clipboard");
    });
  };

  const handleCopyChorePrompt = () => {
    if (!nextChore?.prompt) return;
    navigator.clipboard.writeText(nextChore.prompt).then(() => {
      toast.success("Copied to clipboard");
    });
  };

  return (
    <div>
      {/* Next chore banner */}
      {nextChore && (
        <button
          onClick={handleCopyChorePrompt}
          className="w-full mb-4 flex items-center gap-3 px-4 py-2.5 rounded-md border bg-card text-left hover:bg-accent transition-colors group cursor-pointer"
        >
          <span className="shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            #{nextChore.number}
          </span>
          <span className="font-medium text-sm">{nextChore.name}</span>
          <span className="text-muted-foreground text-sm truncate">
            — {nextChore.task.jiraKey ?? `#${nextChore.task.prNumber}`} {nextChore.task.title}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate max-w-[40%]">
            {nextChore.prompt}
          </span>
        </button>
      )}

      <div className="flex items-center gap-2 mb-4">
        {selectedIds.size > 0 ? (
          <div className="flex-1">
            <BulkActionsBar
              selectedIds={Array.from(selectedIds)}
              onClearSelection={() => setSelectedIds(new Set())}
              onCopyChorePrompt={handleCopyChorePromptForSelection}
            />
          </div>
        ) : (
          <>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Checkbox
                id="hide-low-priority"
                checked={hideLowPriority}
                onCheckedChange={(checked) => setHideLowPriority(checked === true)}
              />
              <Label htmlFor="hide-low-priority" className="text-sm cursor-pointer whitespace-nowrap">
                Sprint view
              </Label>
            </div>
          </>
        )}
        <RefreshButton />
        {selectedIds.size === 0 && (
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        )}
      </div>

      <TaskTable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        titleFilter={debouncedQuery}
        highlightedTaskId={nextChore?.task.id ?? null}
        hideLowPriority={hideLowPriority}
      />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
}
