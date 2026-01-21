import { useState, useMemo } from "react";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { useStatusConfigQuery } from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { Plus } from "lucide-react";

export function TasksPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { data: statusConfig } = useStatusConfigQuery();

  // Build filters from selectable, non-completed statuses, sorted by order
  const statusFilters = useMemo(() => {
    const filters = [{ value: "", label: "All" }];

    if (statusConfig?.statuses) {
      const selectable = statusConfig.statuses
        .filter(s => s.isSelectable && !s.isCompleted)
        .sort((a, b) => a.order - b.order);

      for (const status of selectable) {
        filters.push({ value: status.name, label: status.name });
      }
    }

    return filters;
  }, [statusConfig?.statuses]);

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

      <Tabs value={statusFilter} onValueChange={setStatusFilter} className="mb-6">
        <TabsList>
          {statusFilters.map((filter) => (
            <TabsTrigger key={filter.value} value={filter.value}>
              {filter.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <TaskTable statusFilter={statusFilter || undefined} />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
}
