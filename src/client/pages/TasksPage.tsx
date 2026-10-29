import { useState, useEffect, useMemo } from "react";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import { useTaskFilters, type BoolFilter } from "@/client/lib/taskFilters";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { RepoFilterBar } from "@/client/components/tasks/RepoFilterBar";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { AutoChoresToggle } from "@/client/components/tasks/AutoChoresToggle";
import { BulkActionsBar } from "@/client/components/tasks/BulkActionsBar";
import { SavedSearchBar, effectiveQuery, type SavedSearch } from "@/client/components/tasks/SavedSearchBar";
import { CustomPromptDialog, type PromptChore } from "@/client/components/tasks/CustomPromptDialog";
import { useTasksQuery } from "@/client/lib/queries/tasks";
import { resolvePrompt, type ChoreDefinition } from "@/shared/chores";
import { orderForRepoPair } from "@/shared/chore-pairs";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { FilterToggle } from "@/client/components/ui/filter-toggle";
import { Plus, Search, X } from "lucide-react";

// The URL filters' checkboxes, in display order
const FILTER_TOGGLES: { key: BoolFilter; label: string }[] = [
  { key: "sprint", label: "Sprint view" },
  { key: "backlog", label: "Backlog" },
  { key: "hideOnIce", label: "Hide on ice" },
  { key: "hideParents", label: "Hide parents" },
  { key: "hideIdle", label: "Hide idle" },
  { key: "idleOnly", label: "Show idle" },
];

export function TasksPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [filters, updateFilters] = useTaskFilters();
  const [searchQuery, setSearchQuery] = useState(filters.q);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [compactMode, setCompactMode] = useLocalStorage("tasksPage.compactMode", false);
  const [savedSearchDefs, setSavedSearchDefs] = useLocalStorage<SavedSearch[]>("tasksPage.namedSearches", []);
  // Definitions live in localStorage; which ones are active lives in the URL.
  const savedSearches = savedSearchDefs.map((s) => ({ ...s, active: filters.saved.includes(s.id) }));
  const setSavedSearches = (next: SavedSearch[]) => {
    setSavedSearchDefs(next);
    updateFilters({ saved: next.filter((s) => s.active).map((s) => s.id) });
  };
  const titleFilter = effectiveQuery(filters.q, savedSearches);

  const [bulkPromptTarget, setBulkPromptTarget] = useState<
    { taskId: number; chore: PromptChore | null; initialPrompt?: string; withTaskIds?: number[] } | undefined
  >(undefined);

  useEffect(() => {
    const timer = setTimeout(() => updateFilters({ q: searchQuery.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, updateFilters]);

  // Back/forward changes the URL: bring the input along.
  useEffect(() => {
    setSearchQuery((current) => (current.trim() === filters.q ? current : filters.q));
  }, [filters.q]);

  // Same query + filters as TaskTable, so this reads from the shared cache instead of refetching.
  const { data: tasksData } = useTasksQuery({ title: titleFilter });
  const selectedTasks = useMemo(
    () => (tasksData?.items ?? []).filter((t) => selectedIds.has(t.id)),
    [tasksData?.items, selectedIds],
  );
  const sameRepo =
    selectedTasks.length <= 1 ||
    selectedTasks.every((t) => t.repositoryId !== null && t.repositoryId === selectedTasks[0].repositoryId);

  const selection = selectedTasks.map((t) => ({ id: t.id, repo: t.repository?.repo ?? null }));

  const handleRunChoreForSelection = (chore: ChoreDefinition) => {
    // Runs inside a single session attached to the first selected task; no need for a "shared" session.
    // A multi-repo chore runs on its target task (e.g. alumni_connect) whatever the click order.
    const ids = chore.repoPairs ? orderForRepoPair(chore.repoPairs, selection) : Array.from(selectedIds);
    if (!ids || ids.length === 0) return;
    const prompt = resolvePrompt(chore.prompt, { id: ids[0], jiraKey: null }, ids);
    setBulkPromptTarget({
      taskId: ids[0],
      chore: { number: chore.number, key: chore.key, name: chore.name, prompt },
      withTaskIds: chore.supportsBulk ? ids.slice(1) : undefined, // a multi-repo chore names its tasks in the prompt only
    });
  };

  const handleCustomPromptForSelection = () => {
    // Same as bulk chores: one session on the first selected task, told which tasks it covers.
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const initialPrompt = ids.length > 1 ? `Task Goblin tasks: ${ids.join(", ")}` : undefined;
    setBulkPromptTarget({ taskId: ids[0], chore: null, initialPrompt });
  };

  return (
    <div>
      <div className="flex items-center gap-4 flex-wrap mb-2">
        <SavedSearchBar searches={savedSearches} onChange={setSavedSearches} />
        <div className="flex items-center gap-4">
          {FILTER_TOGGLES.map(({ key, label }) => (
            <FilterToggle
              key={key}
              id={`filter-${key}`}
              label={label}
              checked={filters[key]}
              onCheckedChange={(checked) => updateFilters({ [key]: checked })}
            />
          ))}
          <FilterToggle id="compact-mode" label="Compact mode" checked={compactMode} onCheckedChange={setCompactMode} />
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        {selectedIds.size > 0 ? (
          <div className="flex-1">
            <BulkActionsBar
              selectedIds={Array.from(selectedIds)}
              selection={selection}
              sameRepo={sameRepo}
              repositoryId={sameRepo ? (selectedTasks[0]?.repositoryId ?? null) : null}
              onClearSelection={() => setSelectedIds(new Set())}
              onRunChore={handleRunChoreForSelection}
              onCustomPrompt={handleCustomPromptForSelection}
            />
          </div>
        ) : (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              title="Combine with | (or) and & (and); prefix a term with ~ to exclude it (e.g. tiptap | editor & ~bug)"
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
        )}
        <AutoChoresToggle />
        <RefreshButton />
        {selectedIds.size === 0 && (
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        )}
      </div>

      <RepoFilterBar
        titleFilter={titleFilter}
        selectedRepoId={filters.repo}
        onSelectedRepoIdChange={(repo) => updateFilters({ repo })}
      />

      <TaskTable
        filters={filters}
        titleFilter={titleFilter}
        compactMode={compactMode}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onSearch={setSearchQuery}
      />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
      <CustomPromptDialog
        open={bulkPromptTarget !== undefined}
        onOpenChange={(open) => !open && setBulkPromptTarget(undefined)}
        taskId={bulkPromptTarget?.taskId ?? 0}
        chore={bulkPromptTarget?.chore ?? null}
        initialPrompt={bulkPromptTarget?.initialPrompt}
        withTaskIds={bulkPromptTarget?.withTaskIds}
      />
    </div>
  );
}
