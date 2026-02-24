import { useState, useMemo } from "react";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { BulkActionsBar } from "@/client/components/tasks/BulkActionsBar";
import { BulkDeployResultsDialog } from "@/client/components/tasks/BulkDeployResultsDialog";
import { useTasksQuery, useRepositoriesQuery } from "@/client/lib/queries";
import { useMarkAllLogsRead, useUnreadCountQuery } from "@/client/lib/queries/logs";
import { useBulkDeploy } from "@/client/lib/queries/deploy";
import { Button } from "@/client/components/ui/button";
import { Plus, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import type { BulkDeployResult, TaskWithTodos } from "@/client/lib/types";

export function TasksPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deployTargetBranch, setDeployTargetBranch] = useState("");
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [deployResults, setDeployResults] = useState<BulkDeployResult | null>(null);

  const { data: tasksData } = useTasksQuery({});
  const { data: reposData } = useRepositoriesQuery();
  const bulkDeploy = useBulkDeploy();
  const markAllRead = useMarkAllLogsRead();
  const { data: unreadCount } = useUnreadCountQuery();

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <Button
            variant="outline"
            onClick={() => markAllRead.mutate()}
            disabled={!unreadCount?.count || markAllRead.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all as read
          </Button>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <div className={selectedIds.size === 0 ? "invisible" : ""}>
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
      </div>

      <TaskTable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
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
