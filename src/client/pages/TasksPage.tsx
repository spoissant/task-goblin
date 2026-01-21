import { useState, useMemo } from "react";
import { TaskTable } from "@/client/components/tasks/TaskTable";
import { CreateTaskModal } from "@/client/components/tasks/CreateTaskModal";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import { useStatusConfigQuery } from "@/client/lib/queries/settings";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { Plus } from "lucide-react";

export function TasksPage() {
  const [filterGroup, setFilterGroup] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { data: statusConfig } = useStatusConfigQuery();

  // Build filter tabs ordered by first selectable status's order (highest to lowest)
  const filterTabs = useMemo(() => {
    const tabs: { value: string; label: string; order: number }[] = [
      { value: "", label: "All", order: Infinity },
    ];

    if (statusConfig?.statuses) {
      // Iterate in reverse (bottom to top in settings page)
      // For each filter, use the index of the last non-completed status with that filter
      const seenFilters = new Set<string>();
      for (let i = statusConfig.statuses.length - 1; i >= 0; i--) {
        const status = statusConfig.statuses[i];
        if (!status.isCompleted && status.filter && !seenFilters.has(status.filter)) {
          seenFilters.add(status.filter);
          tabs.push({ value: status.filter, label: status.filter, order: i });
        }
      }
    }

    return tabs;
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

      <Tabs value={filterGroup} onValueChange={setFilterGroup} className="mb-6">
        <TabsList>
          {filterTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <TaskTable filterGroup={filterGroup || undefined} />

      <CreateTaskModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
}
