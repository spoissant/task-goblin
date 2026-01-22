import { useState, useMemo } from "react";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { BulkDeployBar } from "@/client/components/tasks/BulkDeployBar";
import { BulkDeployResultsDialog } from "@/client/components/tasks/BulkDeployResultsDialog";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { useTasksQuery, useRepositoriesQuery } from "@/client/lib/queries";
import { useBulkDeploy } from "@/client/lib/queries/deploy";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { BulkDeployResult, TaskWithTodos } from "@/client/lib/types";

export function TasksPage() {
  const [activeFilter, setActiveFilter] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deployTargetBranch, setDeployTargetBranch] = useState("");
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [deployResults, setDeployResults] = useState<BulkDeployResult | null>(null);

  const { data: statusSettings } = useStatusSettingsQuery();
  const { data: tasksData } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const bulkDeploy = useBulkDeploy();

  // Build task map for results dialog
  const taskMap = useMemo(() => {
    const map = new Map<number, TaskWithTodos>();
    if (tasksData?.items) {
      for (const task of tasksData.items) {
        map.set(task.id, task);
      }
    }
    return map;
  }, [tasksData?.items]);

  // Get selected tasks and their common repository
  const selectedTasks = useMemo(() => {
    return Array.from(selectedIds)
      .map((id) => taskMap.get(id))
      .filter((t): t is TaskWithTodos => !!t);
  }, [selectedIds, taskMap]);

  // Get deployment branches from the common repository (if all selected tasks share one)
  const deploymentBranches = useMemo(() => {
    if (selectedTasks.length === 0) return [];

    // Get unique repository IDs
    const repoIds = new Set(selectedTasks.map((t) => t.repositoryId).filter(Boolean));
    if (repoIds.size !== 1) return []; // Multiple repos - can't bulk deploy

    const repoId = Array.from(repoIds)[0];
    const repo = reposData?.items.find((r) => r.id === repoId);
    if (!repo?.localPath || !repo.deploymentBranches) return [];

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

    // Validate single repository
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

  // Build filter tabs from configured filters, ordered by position
  const filterTabs = useMemo(() => {
    const tabs: { value: string; label: string }[] = [
      { value: "", label: "All" },
    ];

    if (statusSettings?.filters) {
      // Filters are already sorted by position from the API
      for (const filter of statusSettings.filters) {
        tabs.push({ value: filter.name, label: filter.name });
      }
    }

    return tabs;
  }, [statusSettings?.filters]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      <Tabs value={activeFilter} onValueChange={setActiveFilter} className="mb-6">
        <TabsList>
          {filterTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <TaskTable
        activeFilter={activeFilter || undefined}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />

      <BulkDeployBar
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

      <BulkDeployResultsDialog
        open={resultsDialogOpen}
        onOpenChange={setResultsDialogOpen}
        results={deployResults}
        taskMap={taskMap}
      />
    </div>
  );
}
