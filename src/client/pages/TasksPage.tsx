import { useState, useEffect, useMemo } from "react";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { RepoFilterBar } from "@/client/components/tasks/RepoFilterBar";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { BulkActionsBar } from "@/client/components/tasks/BulkActionsBar";
import { CustomPromptDialog, type PromptChore } from "@/client/components/tasks/CustomPromptDialog";
import { type ChoreDefinition, useTasksQuery } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Plus, Search, X } from "lucide-react";

export function TasksPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [repoFilter, setRepoFilter] = useState<number | null>(null);
  const [hideLowPriority, setHideLowPriority] = useLocalStorage("tasksPage.hideLowPriority", true);
  const [hideOnIce, setHideOnIce] = useLocalStorage("tasksPage.hideOnIce", true);
  const [hideParents, setHideParents] = useLocalStorage("tasksPage.hideParents", false);
  const [hideIdle, setHideIdle] = useLocalStorage("tasksPage.hideIdle", false);
  const [compactMode, setCompactMode] = useLocalStorage("tasksPage.compactMode", false);

  const [bulkChoreTarget, setBulkChoreTarget] = useState<(PromptChore & { taskId: number }) | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Same query + filters as TaskTable, so this reads from the shared cache instead of refetching.
  const { data: tasksData } = useTasksQuery({ title: debouncedQuery });
  const selectedTasks = useMemo(
    () => (tasksData?.items ?? []).filter((t) => selectedIds.has(t.id)),
    [tasksData?.items, selectedIds],
  );
  const sameRepo =
    selectedTasks.length <= 1 ||
    selectedTasks.every((t) => t.repositoryId !== null && t.repositoryId === selectedTasks[0].repositoryId);

  const handleRunChoreForSelection = (chore: ChoreDefinition) => {
    // Runs inside a single session attached to the first selected task; no need for a "shared" session.
    const firstTaskId = Array.from(selectedIds)[0];
    if (firstTaskId === undefined) return;
    const ids = Array.from(selectedIds).join(" ");
    const prompt = chore.prompt.replace("{{taskId}}", ids).replace("{{jiraKey}}", "");
    setBulkChoreTarget({ number: chore.number, key: chore.key, name: chore.name, prompt, taskId: firstTaskId });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {selectedIds.size > 0 ? (
          <div className="flex-1">
            <BulkActionsBar
              selectedIds={Array.from(selectedIds)}
              sameRepo={sameRepo}
              onClearSelection={() => setSelectedIds(new Set())}
              onRunChore={handleRunChoreForSelection}
            />
          </div>
        ) : (
          <>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                title="Prefix with ~ to exclude matches (e.g. ~tiptap)"
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
            <div className="flex items-center gap-2 shrink-0">
              <Checkbox
                id="hide-on-ice"
                checked={hideOnIce}
                onCheckedChange={(checked) => setHideOnIce(checked === true)}
              />
              <Label htmlFor="hide-on-ice" className="text-sm cursor-pointer whitespace-nowrap">
                Hide on ice
              </Label>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Checkbox
                id="hide-parents"
                checked={hideParents}
                onCheckedChange={(checked) => setHideParents(checked === true)}
              />
              <Label htmlFor="hide-parents" className="text-sm cursor-pointer whitespace-nowrap">
                Hide parents
              </Label>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Checkbox
                id="hide-idle"
                checked={hideIdle}
                onCheckedChange={(checked) => setHideIdle(checked === true)}
              />
              <Label htmlFor="hide-idle" className="text-sm cursor-pointer whitespace-nowrap">
                Hide idle
              </Label>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Checkbox
                id="compact-mode"
                checked={compactMode}
                onCheckedChange={(checked) => setCompactMode(checked === true)}
              />
              <Label htmlFor="compact-mode" className="text-sm cursor-pointer whitespace-nowrap">
                Compact mode
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

      <RepoFilterBar
        titleFilter={debouncedQuery}
        selectedRepoId={repoFilter}
        onSelectedRepoIdChange={setRepoFilter}
      />

      <TaskTable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        titleFilter={debouncedQuery}
        hideLowPriority={hideLowPriority}
        hideOnIce={hideOnIce}
        hideParents={hideParents}
        hideIdle={hideIdle}
        compactMode={compactMode}
        repoFilter={repoFilter}
      />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
      <CustomPromptDialog
        open={bulkChoreTarget !== undefined}
        onOpenChange={(open) => !open && setBulkChoreTarget(undefined)}
        taskId={bulkChoreTarget?.taskId ?? 0}
        chore={bulkChoreTarget ?? null}
      />
    </div>
  );
}
