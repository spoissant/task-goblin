import { useState, useMemo, useEffect } from "react";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { BulkActionsBar } from "@/client/components/tasks/BulkActionsBar";
import { BulkDeployResultsDialog } from "@/client/components/tasks/BulkDeployResultsDialog";
import {
  useTasksQuery,
  useRepositoriesQuery,
  useNextChoreQuery,
} from "@/client/lib/queries";

import { useBulkDeploy } from "@/client/lib/queries/deploy";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import type { BulkDeployResult, TaskWithTodos } from "@/client/lib/types";

export function TasksPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deployTargetBranch, setDeployTargetBranch] = useState("");
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [deployResults, setDeployResults] = useState<BulkDeployResult | null>(null);
  const [hideLowPriority, setHideLowPriority] = useLocalStorage("tasksPage.hideLowPriority", true);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: tasksData } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const { data: nextChore } = useNextChoreQuery(hideLowPriority);
  const bulkDeploy = useBulkDeploy();

  const taskMap = useMemo(() => {
    const map = new Map<number, TaskWithTodos>();
    if (tasksData?.items) {
      for (const task of tasksData.items) {
        map.set(task.id, task);
      }
    }
    return map;
  }, [tasksData?.items]);

  const selectedTasks = useMemo(() => {
    return Array.from(selectedIds)
      .map((id) => taskMap.get(id))
      .filter((t): t is TaskWithTodos => !!t);
  }, [selectedIds, taskMap]);

  const deploymentBranches = useMemo(() => {
    if (selectedTasks.length === 0) return [];
    const repoIds = new Set(selectedTasks.map((t) => t.repositoryId).filter(Boolean));
    if (repoIds.size !== 1) return [];
    const repoId = Array.from(repoIds)[0];
    const repo = reposData?.items.find((r) => r.id === repoId);
    if (!(repo?.worktrees?.length) || !repo.deploymentBranches) return [];
    try {
      return JSON.parse(repo.deploymentBranches) as string[];
    } catch {
      return [];
    }
  }, [selectedTasks, reposData?.items]);

  const handleBulkDeploy = () => {
    if (!deployTargetBranch) {
      toast.error("Please select a target branch");
      return;
    }
    const repoIds = new Set(selectedTasks.map((t) => t.repositoryId).filter(Boolean));
    if (repoIds.size > 1) {
      toast.error("All selected tasks must be from the same repository");
      return;
    }
    bulkDeploy.mutate(
      { taskIds: Array.from(selectedIds), targetBranch: deployTargetBranch },
      {
        onSuccess: (result) => {
          setDeployResults(result);
          setResultsDialogOpen(true);
          if (result.summary.success > 0 && result.summary.conflict === 0) {
            toast.success(`Deployed ${result.summary.success} task(s) to ${deployTargetBranch}`);
          }
          setSelectedIds(new Set());
          setDeployTargetBranch("");
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Deploy failed");
        },
      }
    );
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
              selectedCount={selectedIds.size}
              deploymentBranches={deploymentBranches}
              targetBranch={deployTargetBranch}
              onTargetBranchChange={setDeployTargetBranch}
              onDeploy={handleBulkDeploy}
              onClearSelection={() => {
                setSelectedIds(new Set());
                setDeployTargetBranch("");
              }}
              isDeploying={bulkDeploy.isPending}
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

      <BulkDeployResultsDialog
        open={resultsDialogOpen}
        onOpenChange={setResultsDialogOpen}
        results={deployResults}
        taskMap={taskMap}
      />
    </div>
  );
}
